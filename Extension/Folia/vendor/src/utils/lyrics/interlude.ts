import type {Line} from '../../types';
export const isInterludeLine=(line:Pick<Line,'fullText'>)=>line.fullText==='......';
