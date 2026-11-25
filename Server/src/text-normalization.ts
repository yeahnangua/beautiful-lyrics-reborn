import OpenCC from "opencc-js/t2cn";

let converter: ReturnType<typeof OpenCC.Converter> | undefined;
export function simplifyChinese(text: string): string {
  converter ??= OpenCC.Converter({ from: "tw", to: "cn" });
  return converter(text);
}
