export const getZoneColorForTrainer = (percentFTP) => {
  if (percentFTP < 55) return 'bg-zinc-500';
  if (percentFTP < 75) return 'bg-sky-500';
  if (percentFTP < 90) return 'bg-emerald-500';
  if (percentFTP < 105) return 'bg-amber-500';
  if (percentFTP < 120) return 'bg-rose-500';
  return 'bg-purple-500';
};
