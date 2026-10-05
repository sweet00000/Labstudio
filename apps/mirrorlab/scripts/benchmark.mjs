import {simulate,DEFAULTS} from '../web/src/physics.js';
console.log('case,samples_per_field,total_rays,exit_rms_arcmin,pupil_fraction,min_pupil_hits,energy_error,elapsed_ms');
for(const samples of [256,1024,4096]) {
  const t=performance.now(),r=simulate({...DEFAULTS,samples});
  console.log(['birdbath',samples,r.total,r.rms,r.ledger.captured,r.minPupilHits,r.energyError,(performance.now()-t).toFixed(2)].join(','));
}
