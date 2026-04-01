import React, { useState, useEffect } from 'react';
import { Loader2, LineChart as LineChartIcon, Info, CalendarDays, ExternalLink } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export default function PowerCurveTab({ intervalsId, intervalsKey, profile }) {
  const [curveData, setCurveData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const [activeFilters, setActiveFilters] = useState(['all', '42d']); 

  const curveConfig = {
    '42d': { id: '42d', label: '42 Dana', color: '#0ea5e9' },
    's0': { id: 's0', label: 'Ova Sezona', color: '#10b981' },
    '1y': { id: '1y', label: '1 Godina', color: '#a855f7' },
    'all': { id: 'all', label: 'Sve (All-Time)', color: '#ea580c' }
  };

  useEffect(() => {
    const fetchCurve = async () => {
      if (!intervalsId || !intervalsKey) {
        setError("Nedostaju API podaci. Poveži se u Postavkama.");
        return;
      }
      setIsLoading(true);
      setError(null);
      
      try {
        const authString = btoa(`API_KEY:${intervalsKey.trim()}`);
        const filterString = activeFilters.join(',');
        
        const response = await fetch(`https://intervals.icu/api/v1/athlete/${intervalsId.trim()}/power-curves.json?curves=${filterString}&type=Ride`, {
          headers: { 'Authorization': `Basic ${authString}`, 'Accept': 'application/json' }
        });
        
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Greška ${response.status}: API je odbio zahtjev. Detalji: ${errText}`);
        }
        
        const data = await response.json();
        const curvesArray = data.list ? data.list : (Array.isArray(data) ? data : [data]); 
        
        if (curvesArray && curvesArray.length > 0) {
          const keySecs = [1, 5, 15, 30, 60, 120, 300, 600, 1200, 2400, 3600];
          const labels = {1:'1s', 5:'5s', 15:'15s', 30:'30s', 60:'1m', 120:'2m', 300:'5m', 600:'10m', 1200:'20m', 2400:'40m', 3600:'1h'};
          
          const parsedData = keySecs.map(sec => {
            const dataPoint = { secs: sec, label: labels[sec] };
            let hasAnyData = false;
            let maxWattsForThisSec = 0;
            let maxActId = null;

            curvesArray.forEach(curve => {
              if (curve && curve.secs && curve.watts) {
                const idx = curve.secs.findIndex(s => s >= sec);
                const watts = idx !== -1 ? curve.watts[idx] : null;
                
                // NOVO: Vadimo ID vožnje iz activity_id niza
                const actId = (idx !== -1 && curve.activity_id) ? curve.activity_id[idx] : null;

                dataPoint[`watts_${curve.id}`] = watts; 
                
                if (watts !== null) {
                  hasAnyData = true;
                  // Tražimo apsolutno najveći rekord i njegov ID vožnje za gumb
                  if (watts > maxWattsForThisSec) {
                      maxWattsForThisSec = watts;
                      maxActId = actId;
                  }
                }
              }
            });
            
            dataPoint.maxWatts = maxWattsForThisSec > 0 ? maxWattsForThisSec : null;
            dataPoint.maxActId = maxActId;
            dataPoint.wkg = dataPoint.maxWatts && profile.weight ? Number((dataPoint.maxWatts / profile.weight).toFixed(1)) : null;

            return hasAnyData ? dataPoint : null;
          }).filter(Boolean);
          
          if (parsedData.length === 0) {
              throw new Error("Odabrano razdoblje nema zabilježenih Watta.");
          }

          setCurveData(parsedData);
        } else {
           throw new Error("Nema dostupnih vožnji za odabrana razdoblja.");
        }
      } catch (err) {
        setError(err.message);
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };

    if (activeFilters.length > 0) {
      fetchCurve();
    } else {
      setCurveData([]); 
    }
  }, [intervalsId, intervalsKey, profile.weight, activeFilters]); 

  const toggleFilter = (filterId) => {
    setActiveFilters(prev => {
      if (prev.includes(filterId)) {
        if (prev.length === 1) return prev; 
        return prev.filter(id => id !== filterId);
      }
      return [...prev, filterId];
    });
  };

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const sortedPayload = [...payload].sort((a, b) => b.value - a.value);
      return (
        <div className="bg-white p-3 border border-stone-200 shadow-sm rounded-lg min-w-[160px]">
          <p className="font-bold text-stone-800 mb-2 border-b border-stone-100 pb-1">{label} Peak Power</p>
          {sortedPayload.map((entry, index) => (
             <div key={index} className="flex justify-between items-center gap-4 py-0.5">
               <span style={{ color: entry.color }} className="font-bold text-xs">{entry.name}</span>
               <span className="font-black text-stone-700">{entry.value} W</span>
             </div>
          ))}
        </div>
      );
    }
    return null;
  };

  const FilterButton = ({ filterId }) => {
    const config = curveConfig[filterId];
    const isActive = activeFilters.includes(filterId);
    
    return (
      <button 
        onClick={() => toggleFilter(filterId)}
        style={isActive ? { backgroundColor: config.color, borderColor: config.color, color: 'white' } : {}}
        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all uppercase tracking-wider border shadow-sm ${
          isActive 
            ? '' 
            : 'bg-white text-stone-500 hover:bg-stone-50 border-stone-200'
        }`}
      >
        {config.label}
      </button>
    );
  };

  return (
    <div className="max-w-[1600px] mx-auto flex flex-col gap-6 animate-in fade-in h-full pb-8">
      
      <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between shrink-0 gap-4">
        <div className="flex items-center gap-4">
          <div className="bg-orange-100 p-3 rounded-xl"><LineChartIcon className="w-6 h-6 text-orange-600"/></div>
          <div>
            <h2 className="text-xl font-bold text-stone-800">Krivulja Snage</h2>
            <p className="text-sm text-stone-500 font-medium">Usporedba tvojih rezultata (MMP) po razdobljima.</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2 bg-stone-50 p-1.5 rounded-xl border border-stone-200 w-full sm:w-auto overflow-x-auto">
          <CalendarDays className="w-4 h-4 text-stone-400 ml-2 mr-1 shrink-0" />
          {Object.keys(curveConfig).map(id => (
             <FilterButton key={id} filterId={id} />
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="flex-1 flex items-center justify-center">
           <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
        </div>
      )}

      {error && !isLoading && (
        <div className="bg-rose-50 text-rose-600 p-6 rounded-xl border border-rose-200 flex flex-col gap-3">
          <div className="font-bold flex items-center gap-2">
            <Info className="w-5 h-5" /> Trenutno ne možemo nacrtati krivulju:
          </div>
          <div className="font-medium">{error}</div>
        </div>
      )}

      {!isLoading && !error && curveData.length > 0 && (
        <>
          <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 flex-1 min-h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={curveData} margin={{ top: 20, right: 20, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e5e4" />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#78716c', fontWeight: 600 }} tickMargin={15} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#78716c' }} axisLine={false} tickLine={false} domain={['dataMin - 20', 'auto']} />
                <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#d6d3d1', strokeWidth: 2, strokeDasharray: '4 4' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '20px' }} />
                
                {activeFilters.map(filterId => {
                   const config = curveConfig[filterId];
                   return (
                     <Line 
                       key={filterId}
                       type="monotone" 
                       dataKey={`watts_${filterId}`} 
                       name={config.label}
                       stroke={config.color} 
                       strokeWidth={3} 
                       connectNulls={true}
                       dot={{ r: 4, fill: config.color, strokeWidth: 2, stroke: '#fff' }} 
                       activeDot={{ r: 7, strokeWidth: 0, fill: config.color }} 
                     />
                   );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 shrink-0">
            {curveData.filter(d => [1, 5, 60, 300, 1200].includes(d.secs)).map(d => (
              <div key={d.secs} className="bg-white border border-stone-200 rounded-2xl p-4 flex flex-col items-center justify-center text-center shadow-sm relative overflow-hidden group hover:border-orange-300 transition-colors">
                <span className="text-[10px] font-black text-stone-400 uppercase tracking-widest mb-1 relative z-10">{d.label} Najbolji</span>
                <span className="text-3xl font-black text-stone-800 relative z-10">{d.maxWatts} <span className="text-sm text-stone-400 font-bold">W</span></span>
                {d.wkg && <span className="text-sm font-bold text-orange-500 mt-0.5 relative z-10">{d.wkg} W/kg</span>}
                
                {/* NOVO: Interaktivni link na vožnju */}
                {d.maxActId && (
                  <a 
                    href={`https://intervals.icu/activities/${d.maxActId}`} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="mt-2 text-[10px] font-bold text-stone-400 hover:text-orange-600 uppercase tracking-widest flex items-center gap-1 transition-colors"
                  >
                    Otvori vožnju <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}