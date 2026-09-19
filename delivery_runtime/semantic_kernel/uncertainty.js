'use strict';

const { sha256, freezeDeep } = require('./stable');

function partitionWorlds(worlds) {
  if (!Array.isArray(worlds) || !worlds.length) throw new Error('POSSIBLE_WORLDS_REQUIRED');
  const ordered = [...worlds].sort((a,b)=>a.start.localeCompare(b.start));
  const partitions=[];
  let current=null;
  for(const world of ordered){
    const sig=sha256(world.claim_states || {});
    if(current && current.signature===sig && current.end===world.start){ current.end=world.end; current.world_ids.push(world.world_id); }
    else { if(current) partitions.push(current); current={start:world.start,end:world.end,signature:sig,claim_states:world.claim_states,world_ids:[world.world_id]}; }
  }
  if(current) partitions.push(current);
  const claimIds=[...new Set(ordered.flatMap((w)=>Object.keys(w.claim_states||{})))];
  const robustness={};
  for(const id of claimIds){
    const vals=ordered.map((w)=>w.claim_states?.[id] ?? 'UNKNOWN-UNRESOLVED');
    const unique=[...new Set(vals)];
    robustness[id]=unique.length===1 ? 'ROBUST' : unique.includes('SUPPORTED')&&unique.includes('REFUTED') ? 'UNSTABLE' : 'CONDITIONAL';
  }
  return freezeDeep({partitions,robustness});
}

function robustnessVector(baseClaim, perturbations) {
  const vector={};
  for(const [axis,values] of Object.entries(perturbations||{})){
    const first=(values||[]).find((v)=>v.claim_state!==baseClaim);
    vector[axis]=first ? first.delta : null;
  }
  return freezeDeep(vector);
}

module.exports={partitionWorlds,robustnessVector};
