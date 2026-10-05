import {simulate,sweepAxes,sweepCell,validate} from './physics.js';
self.onmessage=({data})=>{
  const {type,id,parameters}=data;
  try {
    const p=validate(parameters);
    if(type==='trace') {self.postMessage({type,id,result:simulate(p)});return;}
    if(type==='sweep') {
      const axes=sweepAxes(p),cells=[];let best=null;
      for(let j=0;j<axes.distances.length;j++) {
        for(const radius of axes.radii) {
          const cell=sweepCell(p,radius,axes.distances[j]);cells.push(cell);
          if(cell.feasible && (!best || cell.score<best.score)) best=cell;
        }
        self.postMessage({type:'progress',id,progress:(j+1)/axes.distances.length});
      }
      self.postMessage({type,id,result:{...axes,cells,best,parameters:p}});
    }
  } catch(error) {self.postMessage({type:'error',id,message:error.message});}
};
