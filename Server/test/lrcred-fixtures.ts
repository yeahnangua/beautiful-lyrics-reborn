export const redTtml = (body: string, timing = "Word") =>
  `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:lrc="http://lrc.red/lyric-ttml-internal" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" lrc:timing="${timing}"><body><div>${body}</div></body></tt>`;
export const redWords = redTtml('<p begin="1" end="3"><span begin="1" end="2">Hello</span> <span begin="2" end="3">world</span></p>');
