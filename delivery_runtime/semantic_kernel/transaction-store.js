'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sha256 } = require('./stable');
const { verifyFrozenArtifact } = require('./kernel');

class AtomicSemanticStore {
  constructor(directory) {
    this.directory=directory;
    this.acceptedPath=path.join(directory,'accepted.json');
    this.ledgerPath=path.join(directory,'ledger.ndjson');
  }
  init(){fs.mkdirSync(this.directory,{recursive:true});}
  readAccepted(){
    this.init();
    if(!fs.existsSync(this.acceptedPath)) return null;
    const value=JSON.parse(fs.readFileSync(this.acceptedPath,'utf8'));
    verifyFrozenArtifact(value);
    return value;
  }
  commit(artifact,{crashBeforeRename=false}={}){
    verifyFrozenArtifact(artifact);
    this.init();
    const tmp=`${this.acceptedPath}.candidate-${process.pid}`;
    const ledgerTmp=`${this.ledgerPath}.candidate-${process.pid}`;
    fs.writeFileSync(tmp,`${JSON.stringify(artifact)}\n`,{flag:'w'});
    const fd=fs.openSync(tmp,'r'); fs.fsyncSync(fd); fs.closeSync(fd);
    const parent=this.readAccepted();
    const entry={transition_id:artifact.transition.transition_id,parent:parent?.artifact_sha256||null,resulting:artifact.artifact_sha256,artifact_sha256:sha256(artifact)};
    const prior=fs.existsSync(this.ledgerPath)?fs.readFileSync(this.ledgerPath,'utf8'):'';
    fs.writeFileSync(ledgerTmp,`${prior}${JSON.stringify(entry)}\n`,{flag:'w'});
    if(crashBeforeRename) throw new Error('SIMULATED_CRASH_BEFORE_COMMIT');
    fs.renameSync(tmp,this.acceptedPath);
    fs.renameSync(ledgerTmp,this.ledgerPath);
    return entry;
  }
  verifyConsistency(){
    const accepted=this.readAccepted();
    if(!accepted) return {ok:true,state:'EMPTY'};
    const lines=fs.existsSync(this.ledgerPath)?fs.readFileSync(this.ledgerPath,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
    const last=lines.at(-1);
    if(!last||last.resulting!==accepted.artifact_sha256||last.transition_id!==accepted.transition.transition_id) throw new Error('ACCEPTED_LEDGER_MISMATCH');
    return {ok:true,state:'CONSISTENT',transition_id:last.transition_id};
  }
}

module.exports={AtomicSemanticStore};
