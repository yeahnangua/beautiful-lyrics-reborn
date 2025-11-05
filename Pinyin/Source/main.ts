import PinyinBase, { getPinyinInstance } from "./base.ts";
import type { IPinyin } from "./declare.ts";

export class Pinyin extends PinyinBase {
}

export const pinyin: IPinyin = getPinyinInstance(new Pinyin());
export default pinyin;

export const compare = pinyin.compare;
export { compact } from "./util.ts";
