// Zwift Click / Play / Ride Web Bluetooth servis za virtualno mijenjanje brzina i ERG kontrolu

export const ZWIFT_LEGACY_SERVICE_UUID = '00000001-19ca-4651-86e5-fa29dcdd09d1';
export const ZWIFT_MODERN_SERVICE_UUID = '0000fc82-0000-1000-8000-00805f9b34fb';
export const ZWIFT_MODERN_SHORT_UUID = 0xfc82;

const ZWIFT_ASYNC_NOTIFY_CHAR_UUID = '00000002-19ca-4651-86e5-fa29dcdd09d1';
const ZWIFT_CONTROL_WRITE_CHAR_UUID = '00000003-19ca-4651-86e5-fa29dcdd09d1';
const ZWIFT_SYNC_INDICATE_CHAR_UUID = '00000004-19ca-4651-86e5-fa29dcdd09d1';

const ZWIFT_MANUFACTURER_ID = 0x094a;
const RIDE_ON_BYTES = new Uint8Array([0x52, 0x69, 0x64, 0x65, 0x4f, 0x6e]); // "RideOn"

const STORAGE_KEY_SWAP = 'ergvibe_zwift_click_swap_v1';
const STORAGE_KEY_CUSTOM_MAP = 'ergvibe_zwift_click_custom_map_v1';

// Poznati idle / heartbeat / telemetrijski opcodovi koji nisu pritisci tipki
const IDLE_OPCODES = new Set([0x15, 0x19, 0x17, 0x2a, 0x03, 0x3c, 0x00]);

// Bitmaske za 0x23 (Zwift Click v2 / Ride / ujedinjeni protokol) - aktivna nula u sirovom paketu
// Nakon inverzije: 1 = pritisnuto
const UP_MASK_23 =
  0x00000002 | // UP_BTN
  0x00000004 | // RIGHT_BTN
  0x00000010 | // A_BTN
  0x00000040 | // Y_BTN
  0x00000200 | // SHFT_UP_L_BTN
  0x00002000 | // SHFT_UP_R_BTN
  0x00010000;  // POWERUP_R_BTN

const DOWN_MASK_23 =
  0x00000001 | // LEFT_BTN
  0x00000008 | // DOWN_BTN
  0x00000020 | // B_BTN
  0x00000100 | // Z_BTN
  0x00000400 | // SHFT_DN_L_BTN
  0x00000800 | // POWERUP_L_BTN
  0x00004000;  // SHFT_DN_R_BTN

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
}

function startsWithRideOn(bytes) {
  if (!bytes || bytes.length < 6) return false;
  for (let i = 0; i < 6; i++) {
    if (bytes[i] !== RIDE_ON_BYTES[i]) return false;
  }
  return true;
}

/**
 * Čita Protobuf varint polja iz binarnog niza počevši od zadanog offseta.
 * Koristi BigInt kako 32-bitne bitmaske (npr. 0xfffffffe) ne bi izgubile predznak.
 */
export function parseProtobufVarints(bytes, startOffset = 1) {
  const fields = new Map();
  let offset = startOffset;

  const readVarint = () => {
    let result = 0n;
    let shift = 0n;
    while (offset < bytes.length) {
      const b = bytes[offset++];
      result |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) return result;
      shift += 7n;
      if (shift > 70n) return null; // zaštita od neispravnog paketa
    }
    return null;
  };

  while (offset < bytes.length) {
    const tag = readVarint();
    if (tag === null) break;
    const fieldNum = Number(tag >> 3n);
    const wireType = Number(tag & 0x07n);
    if (fieldNum <= 0) break;

    if (wireType === 0) {
      const val = readVarint();
      if (val === null) break;
      fields.set(fieldNum, val);
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 2) {
      const len = readVarint();
      if (len === null) break;
      offset += Number(len);
    } else if (wireType === 5) {
      if (offset + 4 <= bytes.length) {
        const u32 =
          (bytes[offset] |
            (bytes[offset + 1] << 8) |
            (bytes[offset + 2] << 16) |
            (bytes[offset + 3] << 24)) >>>
          0;
        fields.set(fieldNum, BigInt(u32));
      }
      offset += 4;
    } else {
      break;
    }
  }

  return fields;
}

function loadSwapPreference() {
  try {
    return localStorage.getItem(STORAGE_KEY_SWAP) === 'true';
  } catch {
    return false;
  }
}

function loadCustomMap() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CUSTOM_MAP);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.upSig && parsed.downSig) return parsed;
    return null;
  } catch {
    return null;
  }
}

function matchesLearnedSignature(bytes, sig) {
  if (!sig || !bytes || bytes.length === 0) return false;
  if (bytes[0] !== sig.msgId) return false;
  if (sig.type === 'bit') {
    if (bytes.length <= sig.byteIndex) {
      // Proto3 izostavljeno polje kad je 0
      return sig.expectedBit === 0;
    }
    return (bytes[sig.byteIndex] & sig.mask) === sig.expectedBit;
  }
  if (sig.type === 'exact') {
    return bytesToHex(bytes) === sig.hex;
  }
  return false;
}

function buildSignatureFromIdleAndPressed(idleBytes, pressedBytes) {
  const msgId = pressedBytes[0];
  if (idleBytes && idleBytes[0] === msgId) {
    const minLen = Math.min(idleBytes.length, pressedBytes.length);
    for (let i = 1; i < minLen; i++) {
      const diff = idleBytes[i] ^ pressedBytes[i];
      if (diff !== 0) {
        // Uzmi najniži bit koji se promijenio
        const lowestBitMask = diff & -diff;
        return {
          type: 'bit',
          msgId,
          byteIndex: i,
          mask: lowestBitMask,
          expectedBit: pressedBytes[i] & lowestBitMask,
          hex: bytesToHex(pressedBytes)
        };
      }
    }
  }
  return {
    type: 'exact',
    msgId,
    hex: bytesToHex(pressedBytes)
  };
}

export class ZwiftClickController {
  constructor() {
    this.device = null;
    this.server = null;
    this.controlChar = null;
    this.notifyChars = [];
    this.connected = false;
    this.intentionalDisconnect = false;
    this.handshakeOk = false;
    this.deviceName = '';
    this.batteryLevel = null;
    this.packetCount = 0;
    this.clickCount = 0;
    this.lastPacketHex = '';

    this.swapButtons = loadSwapPreference();
    this.customMap = loadCustomMap();
    this.calibrationStep = 'idle'; // 'idle' | 'wait_plus' | 'wait_release' | 'wait_minus'
    this.lastIdleSample = null;
    this.pendingUpSig = null;

    this.idleBitmap23 = 0x0003f77f; // početna maska poznatih Zwift tipki
    this.rawPlusDown = false;
    this.rawMinusDown = false;
    this.plusDownAt = 0;
    this.minusDownAt = 0;
    this.lastPlusUpAt = 0;
    this.lastMinusUpAt = 0;
    this.plusSafetyTimer = null;
    this.minusSafetyTimer = null;

    this.onButtonDown = null;
    this.onButtonUp = null;
    this.onStateChange = null;

    this._boundDisconnectHandler = this._handleDisconnected.bind(this);
    this._boundNotificationHandler = this._handleNotification.bind(this);
  }

  getSnapshot() {
    return {
      connected: this.connected,
      handshakeOk: this.handshakeOk,
      deviceName: this.deviceName,
      batteryLevel: this.batteryLevel,
      packetCount: this.packetCount,
      clickCount: this.clickCount,
      lastPacketHex: this.lastPacketHex,
      swapButtons: this.swapButtons,
      hasCustomMap: Boolean(this.customMap),
      calibrationStep: this.calibrationStep
    };
  }

  _emitState() {
    if (typeof this.onStateChange === 'function') {
      this.onStateChange(this.getSnapshot());
    }
  }

  setSwapButtons(swap) {
    this.swapButtons = Boolean(swap);
    try {
      localStorage.setItem(STORAGE_KEY_SWAP, String(this.swapButtons));
    } catch {
      // ignore
    }
    this._emitState();
  }

  toggleSwapButtons() {
    this.setSwapButtons(!this.swapButtons);
    return this.swapButtons;
  }

  startCalibration() {
    this._resetButtonState();
    this.pendingUpSig = null;
    this.calibrationStep = 'wait_plus';
    this._emitState();
  }

  cancelCalibration() {
    this.pendingUpSig = null;
    this.calibrationStep = 'idle';
    this._emitState();
  }

  clearCustomMap() {
    this.customMap = null;
    this.calibrationStep = 'idle';
    try {
      localStorage.removeItem(STORAGE_KEY_CUSTOM_MAP);
    } catch {
      // ignore
    }
    this._emitState();
  }

  async requestAndConnect() {
    if (typeof navigator === 'undefined' || !navigator.bluetooth) {
      throw new Error('Tvoj preglednik ne podržava Web Bluetooth (koristi Chrome ili Edge).');
    }

    const optionalServices = [
      ZWIFT_LEGACY_SERVICE_UUID,
      ZWIFT_MODERN_SERVICE_UUID,
      ZWIFT_MODERN_SHORT_UUID,
      'battery_service',
      'device_information'
    ];

    let device = null;
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [
          { services: [ZWIFT_LEGACY_SERVICE_UUID] },
          { services: [ZWIFT_MODERN_SERVICE_UUID] },
          { services: [ZWIFT_MODERN_SHORT_UUID] },
          { manufacturerData: [{ companyIdentifier: ZWIFT_MANUFACTURER_ID }] },
          { namePrefix: 'Zwift' },
          { namePrefix: 'Click' },
          { namePrefix: 'ZC' }
        ],
        optionalServices
      });
    } catch (err) {
      // Fallback za preglednike koji ne podržavaju manufacturerData filter
      if (err && err.name === 'TypeError') {
        device = await navigator.bluetooth.requestDevice({
          filters: [
            { services: [ZWIFT_LEGACY_SERVICE_UUID] },
            { services: [ZWIFT_MODERN_SERVICE_UUID] },
            { namePrefix: 'Zwift' },
            { namePrefix: 'Click' }
          ],
          optionalServices
        });
      } else {
        throw err;
      }
    }

    await this.connectDevice(device);
    return this.getSnapshot();
  }

  async connectDevice(device) {
    if (this.device && this.device !== device) {
      this.disconnect();
    }

    this.intentionalDisconnect = false;
    this.device = device;
    this.deviceName = device.name || 'Zwift Click';
    this.handshakeOk = false;
    this._resetButtonState();

    device.removeEventListener('gattserverdisconnected', this._boundDisconnectHandler);
    device.addEventListener('gattserverdisconnected', this._boundDisconnectHandler);

    const server = await device.gatt.connect();
    this.server = server;

    // 1. Pronađi primarni Zwift GATT servis (128-bitni legacy ili 16-bitni 0xFC82)
    let zwiftService = null;
    const candidateServices = [ZWIFT_LEGACY_SERVICE_UUID, ZWIFT_MODERN_SERVICE_UUID, ZWIFT_MODERN_SHORT_UUID];
    for (const uuid of candidateServices) {
      try {
        zwiftService = await server.getPrimaryService(uuid);
        if (zwiftService) break;
      } catch {
        // probaj idući UUID
      }
    }

    if (!zwiftService) {
      try {
        const allServices = await server.getPrimaryServices();
        zwiftService = allServices.find(
          (s) =>
            !s.uuid.startsWith('00001800') &&
            !s.uuid.startsWith('00001801') &&
            !s.uuid.startsWith('0000180a') &&
            !s.uuid.startsWith('0000180f')
        );
      } catch {
        // ignore
      }
    }

    if (!zwiftService) {
      throw new Error('Na odabranom uređaju nije pronađen Zwift Click servis. Provjeri jesi li odabrao pravi uređaj.');
    }

    // 2. Dohvati sve karakteristike i pretplati se STROGO SEKVENCIJALNO (prvo Indicate 0004, pa Notify 0002)
    const chars = await zwiftService.getCharacteristics();
    this.notifyChars = [];
    this.controlChar = null;

    const orderedChars = [...chars].sort((a, b) => {
      const score = (c) => {
        if (c.uuid === ZWIFT_SYNC_INDICATE_CHAR_UUID) return 1;
        if (c.uuid === ZWIFT_ASYNC_NOTIFY_CHAR_UUID) return 2;
        if (c.properties?.indicate) return 3;
        if (c.properties?.notify) return 4;
        return 10;
      };
      return score(a) - score(b);
    });

    for (const c of orderedChars) {
      if (c.uuid === ZWIFT_CONTROL_WRITE_CHAR_UUID || c.properties?.writeWithoutResponse || c.properties?.write) {
        if (!this.controlChar || c.uuid === ZWIFT_CONTROL_WRITE_CHAR_UUID) {
          this.controlChar = c;
        }
      }

      if (c.properties?.notify || c.properties?.indicate) {
        try {
          await c.startNotifications();
          c.removeEventListener('characteristicvaluechanged', this._boundNotificationHandler);
          c.addEventListener('characteristicvaluechanged', this._boundNotificationHandler);
          this.notifyChars.push(c);
          await sleepMs(80);
        } catch (subErr) {
          console.warn('[ZwiftClick] Neuspjela pretplata na karakteristiku:', c.uuid, subErr);
        }
      }
    }

    // 3. Pošalji "RideOn" handshake za otključavanje neenkriptiranog Protobuf streama
    if (this.controlChar) {
      await this._sendRideOnHandshake();
      await sleepMs(120);
      // Ako iz dubokog sna prvi paket nije probudio stream, ponovi još jednom nakon 500ms
      setTimeout(() => {
        if (this.connected && !this.handshakeOk && this.packetCount === 0 && this.controlChar) {
          this._sendRideOnHandshake().catch(() => {});
        }
      }, 550);
    }

    // 4. Opcionalno očitaj razinu baterije (0x180F -> 0x2A19)
    try {
      const battService = await server.getPrimaryService('battery_service');
      const battChar = await battService.getCharacteristic('battery_level');
      const battVal = await battChar.readValue();
      if (battVal && battVal.byteLength >= 1) {
        this.batteryLevel = battVal.getUint8(0);
      }
    } catch {
      // Baterijski servis nije obavezan
    }

    this.connected = true;
    this._emitState();
    console.log(`[ZwiftClick] Spojen: ${this.deviceName}`);
  }

  async _sendRideOnHandshake() {
    if (!this.controlChar) return;
    try {
      if (this.controlChar.properties?.writeWithoutResponse && this.controlChar.writeValueWithoutResponse) {
        await this.controlChar.writeValueWithoutResponse(RIDE_ON_BYTES);
      } else if (this.controlChar.writeValueWithResponse) {
        await this.controlChar.writeValueWithResponse(RIDE_ON_BYTES);
      } else {
        await this.controlChar.writeValue(RIDE_ON_BYTES);
      }
      console.log('[ZwiftClick] Poslan "RideOn" handshake.');
    } catch (err) {
      console.warn('[ZwiftClick] Greška pri slanju RideOn handshakea (pokušavam fallback):', err);
      try {
        await this.controlChar.writeValue(RIDE_ON_BYTES);
      } catch (err2) {
        console.warn('[ZwiftClick] Fallback RideOn write nije uspio:', err2);
      }
    }
  }

  async _handleDisconnected() {
    this._resetButtonState();
    this.connected = false;
    this.handshakeOk = false;
    this.controlChar = null;
    this.notifyChars = [];
    this._emitState();

    // Tihi pokušaj automatskog rekonekta ako se veza kratko prekinula u vožnji
    if (!this.intentionalDisconnect && this.device) {
      console.info('[ZwiftClick] Neočekivani prekid veze, pokušavam automatski rekonekt za 800ms...');
      await sleepMs(800);
      if (!this.intentionalDisconnect && this.device && !this.connected) {
        try {
          await this.connectDevice(this.device);
        } catch (reErr) {
          console.info('[ZwiftClick] Automatski rekonekt nije uspio (uređaj vjerojatno u sleep modu):', reErr);
        }
      }
    }
  }

  disconnect() {
    this.intentionalDisconnect = true;
    this._resetButtonState();
    this.calibrationStep = 'idle';

    for (const c of this.notifyChars) {
      try {
        c.removeEventListener('characteristicvaluechanged', this._boundNotificationHandler);
      } catch {
        // ignore
      }
    }
    this.notifyChars = [];
    this.controlChar = null;

    if (this.device) {
      try {
        this.device.removeEventListener('gattserverdisconnected', this._boundDisconnectHandler);
        if (this.device.gatt?.connected) {
          this.device.gatt.disconnect();
        }
      } catch (e) {
        console.warn('[ZwiftClick] Greška pri odspajanju:', e);
      }
    }

    this.device = null;
    this.server = null;
    this.connected = false;
    this.handshakeOk = false;
    this.batteryLevel = null;
    this._emitState();
  }

  _resetButtonState() {
    if (this.plusSafetyTimer) clearTimeout(this.plusSafetyTimer);
    if (this.minusSafetyTimer) clearTimeout(this.minusSafetyTimer);
    this.plusSafetyTimer = null;
    this.minusSafetyTimer = null;
    this.rawPlusDown = false;
    this.rawMinusDown = false;
  }

  _handleNotification(event) {
    const dv = event?.target?.value;
    if (!dv || dv.byteLength === 0) return;

    const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
    this.packetCount += 1;

    // 1. Provjeri "RideOn" odgovor na handshake
    if (startsWithRideOn(bytes)) {
      this.handshakeOk = true;
      this.lastPacketHex = 'RideOn (OK)';
      this._emitState();
      return;
    }

    const msgId = bytes[0];
    if (IDLE_OPCODES.has(msgId)) {
      return;
    }

    const hex = bytesToHex(bytes);
    this.lastPacketHex = hex;

    // 2. Dekodiraj sirovo stanje tipki (+ i -)
    const decoded = this._decodeButtonStates(bytes);

    // 3. Ako je aktivan čarobnjak za kalibraciju tipki, obradi učenje
    if (this.calibrationStep !== 'idle') {
      this._processCalibrationPacket(bytes, decoded);
      this._emitState();
      return;
    }

    if (!decoded) {
      this._emitState();
      return;
    }

    // Zapamti zadnji paket u kojem nijedna tipka nije stisnuta (korisno za kalibraciju)
    if (!decoded.plusPressed && !decoded.minusPressed) {
      this.lastIdleSample = new Uint8Array(bytes);
    }

    this._updateEdgeState(decoded.plusPressed, decoded.minusPressed);
    this._emitState();
  }

  _processCalibrationPacket(bytes, decoded) {
    const isNeutralStandard = decoded && !decoded.plusPressed && !decoded.minusPressed;
    const isSameAsIdle =
      this.lastIdleSample && bytesToHex(this.lastIdleSample) === bytesToHex(bytes);

    if (isNeutralStandard || isSameAsIdle) {
      if (!this.lastIdleSample) {
        this.lastIdleSample = new Uint8Array(bytes);
      }
      if (this.calibrationStep === 'wait_release') {
        this.calibrationStep = 'wait_minus';
      }
      return;
    }

    if (this.calibrationStep === 'wait_plus') {
      this.pendingUpSig = buildSignatureFromIdleAndPressed(this.lastIdleSample, bytes);
      this.calibrationStep = 'wait_release';
      // Ako korisnik pusti bez slanja idle paketa, nakon 700ms prijeđi na minus korak
      setTimeout(() => {
        if (this.calibrationStep === 'wait_release') {
          this.calibrationStep = 'wait_minus';
          this._emitState();
        }
      }, 700);
      return;
    }

    if (this.calibrationStep === 'wait_minus') {
      // Ignoriraj ako još uvijek drži istu + tipku
      if (this.pendingUpSig && matchesLearnedSignature(bytes, this.pendingUpSig)) {
        return;
      }
      const downSig = buildSignatureFromIdleAndPressed(this.lastIdleSample, bytes);
      this.customMap = {
        upSig: this.pendingUpSig,
        downSig
      };
      this.pendingUpSig = null;
      this.calibrationStep = 'idle';
      try {
        localStorage.setItem(STORAGE_KEY_CUSTOM_MAP, JSON.stringify(this.customMap));
      } catch {
        // ignore
      }
    }
  }

  _decodeButtonStates(bytes) {
    if (!bytes || bytes.length === 0) return null;

    // A) Korisnički kalibrirana mapa (ako postoji) ima najviši prioritet
    if (this.customMap?.upSig && this.customMap?.downSig) {
      const msgMatches =
        bytes[0] === this.customMap.upSig.msgId || bytes[0] === this.customMap.downSig.msgId;
      if (msgMatches) {
        return {
          plusPressed: matchesLearnedSignature(bytes, this.customMap.upSig),
          minusPressed: matchesLearnedSignature(bytes, this.customMap.downSig)
        };
      }
    }

    const msgId = bytes[0];
    const fields = parseProtobufVarints(bytes, 1);

    // B) 0x37: Zwift Click v1 (Model Z006) - polje 1 = Plus (0=stisnuto, 1=pušteno), polje 2 = Minus (0=stisnuto, 1=pušteno)
    if (msgId === 0x37) {
      const f1 = fields.has(1) ? fields.get(1) : 0n;
      const f2 = fields.has(2) ? fields.get(2) : 0n;
      return {
        plusPressed: f1 === 0n,
        minusPressed: f2 === 0n
      };
    }

    // C) 0x23: Zwift Click v2 (Model Z007) / Zwift Ride / ujedinjeni 32-bitni protokol (aktivna nula)
    if (msgId === 0x23) {
      const rawBig = fields.has(1) ? fields.get(1) : 0n;
      const rawMask = Number(rawBig & 0xffffffffn) >>> 0;
      // Svaki bit koji je '1' označava otpuštenu tipku u active-low protokolu
      this.idleBitmap23 = (this.idleBitmap23 | rawMask) >>> 0;
      const pressedMask = (this.idleBitmap23 & ~rawMask) >>> 0;

      return {
        plusPressed: (pressedMask & UP_MASK_23) !== 0,
        minusPressed: (pressedMask & DOWN_MASK_23) !== 0
      };
    }

    // D) 0x07: Zwift Play kontroleri (polje 1: 0=desni, 1=lijevi; polja 2..6 tipke s aktivnom nulom)
    if (msgId === 0x07) {
      const isLeft = (fields.has(1) ? fields.get(1) : 0n) === 1n;
      const yUp = (fields.has(2) ? fields.get(2) : 1n) === 0n;
      const zLeft = (fields.has(3) ? fields.get(3) : 1n) === 0n;
      const aRight = (fields.has(4) ? fields.get(4) : 1n) === 0n;
      const bDown = (fields.has(5) ? fields.get(5) : 1n) === 0n;
      const shiftPaddle = (fields.has(6) ? fields.get(6) : 1n) === 0n;

      return {
        plusPressed: (!isLeft && shiftPaddle) || yUp || aRight,
        minusPressed: (isLeft && shiftPaddle) || bDown || zLeft
      };
    }

    return null;
  }

  _mapDirection(rawDir) {
    if (!this.swapButtons) return rawDir;
    return rawDir === 'up' ? 'down' : 'up';
  }

  _updateEdgeState(plusPressed, minusPressed) {
    const now = Date.now();

    // --- PLUS TIPKA ---
    if (plusPressed && !this.rawPlusDown) {
      if (now - this.lastPlusUpAt >= 35) {
        this.rawPlusDown = true;
        this.plusDownAt = now;
        this.clickCount += 1;
        const dir = this._mapDirection('up');
        if (typeof this.onButtonDown === 'function') {
          this.onButtonDown(dir, { raw: 'plus', timestamp: now });
        }
        // Sigurnosni watchdog ako se u garaži izgubi BLE release paket
        if (this.plusSafetyTimer) clearTimeout(this.plusSafetyTimer);
        this.plusSafetyTimer = setTimeout(() => {
          if (this.rawPlusDown) {
            this.rawPlusDown = false;
            this.lastPlusUpAt = Date.now();
            const d = this._mapDirection('up');
            if (typeof this.onButtonUp === 'function') {
              this.onButtonUp(d, Date.now() - this.plusDownAt, { timeout: true });
            }
          }
        }, 4000);
      }
    } else if (!plusPressed && this.rawPlusDown) {
      if (this.plusSafetyTimer) clearTimeout(this.plusSafetyTimer);
      this.plusSafetyTimer = null;
      this.rawPlusDown = false;
      this.lastPlusUpAt = now;
      const heldMs = Math.max(0, now - this.plusDownAt);
      const dir = this._mapDirection('up');
      if (typeof this.onButtonUp === 'function') {
        this.onButtonUp(dir, heldMs, { raw: 'plus', timestamp: now });
      }
    }

    // --- MINUS TIPKA ---
    if (minusPressed && !this.rawMinusDown) {
      if (now - this.lastMinusUpAt >= 35) {
        this.rawMinusDown = true;
        this.minusDownAt = now;
        this.clickCount += 1;
        const dir = this._mapDirection('down');
        if (typeof this.onButtonDown === 'function') {
          this.onButtonDown(dir, { raw: 'minus', timestamp: now });
        }
        if (this.minusSafetyTimer) clearTimeout(this.minusSafetyTimer);
        this.minusSafetyTimer = setTimeout(() => {
          if (this.rawMinusDown) {
            this.rawMinusDown = false;
            this.lastMinusUpAt = Date.now();
            const d = this._mapDirection('down');
            if (typeof this.onButtonUp === 'function') {
              this.onButtonUp(d, Date.now() - this.minusDownAt, { timeout: true });
            }
          }
        }, 4000);
      }
    } else if (!minusPressed && this.rawMinusDown) {
      if (this.minusSafetyTimer) clearTimeout(this.minusSafetyTimer);
      this.minusSafetyTimer = null;
      this.rawMinusDown = false;
      this.lastMinusUpAt = now;
      const heldMs = Math.max(0, now - this.minusDownAt);
      const dir = this._mapDirection('down');
      if (typeof this.onButtonUp === 'function') {
        this.onButtonUp(dir, heldMs, { raw: 'minus', timestamp: now });
      }
    }
  }
}

// Virtualno mjenjačko mapiranje (1 - 24 brzine)
export const VIRTUAL_GEAR_MIN = 1;
export const VIRTUAL_GEAR_MAX = 24;
export const VIRTUAL_GEAR_DEFAULT = 8; // Brzina 8/24 (~33% otpora / ravna cesta za Zwift Cog)

/**
 * Pretvara virtualnu brzinu (1-24) u postotak otpora kočnice (5% - 97%).
 */
export function gearToResistancePercent(gear) {
  const g = Math.max(VIRTUAL_GEAR_MIN, Math.min(VIRTUAL_GEAR_MAX, Math.round(gear)));
  return 5 + (g - 1) * 4;
}

/**
 * Pretvara virtualnu brzinu (1-24) u simulirani nagib ceste za FTMS 0x11 (-1.5% do +10.0%).
 */
export function gearToSimulatedGrade(gear) {
  const g = Math.max(VIRTUAL_GEAR_MIN, Math.min(VIRTUAL_GEAR_MAX, Math.round(gear)));
  return Math.round((-1.5 + (g - 1) * 0.5) * 10) / 10;
}
