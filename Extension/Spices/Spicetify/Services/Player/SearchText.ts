import OpenCC from "npm:opencc-js@1.3.1/t2cn"

const simplify = OpenCC.Converter({ from: "tw", to: "cn" })

export const SimplifySearchText = (text: string): string => simplify(text)
