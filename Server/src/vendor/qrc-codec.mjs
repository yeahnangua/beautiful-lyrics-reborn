// Adapted from qrc-decoder 1.0.2 (MIT). Bounded streaming decompression.
import { deflate, Inflate } from "pako";
//#region src/constants.ts
/**
* @internal
* @module constants
* @description
* 包含了所有 `custom_des` 模块所需的常量数据。
*/
const KEY_1 = new TextEncoder().encode("!@#)(*$%");
const KEY_2 = new TextEncoder().encode("123ZXC!@");
const KEY_3 = new TextEncoder().encode("!@#)(NHL");
const S_BOXES = [
	[
		14,
		4,
		13,
		1,
		2,
		15,
		11,
		8,
		3,
		10,
		6,
		12,
		5,
		9,
		0,
		7,
		0,
		15,
		7,
		4,
		14,
		2,
		13,
		1,
		10,
		6,
		12,
		11,
		9,
		5,
		3,
		8,
		4,
		1,
		14,
		8,
		13,
		6,
		2,
		11,
		15,
		12,
		9,
		7,
		3,
		10,
		5,
		0,
		15,
		12,
		8,
		2,
		4,
		9,
		1,
		7,
		5,
		11,
		3,
		14,
		10,
		0,
		6,
		13
	],
	[
		15,
		1,
		8,
		14,
		6,
		11,
		3,
		4,
		9,
		7,
		2,
		13,
		12,
		0,
		5,
		10,
		3,
		13,
		4,
		7,
		15,
		2,
		8,
		15,
		12,
		0,
		1,
		10,
		6,
		9,
		11,
		5,
		0,
		14,
		7,
		11,
		10,
		4,
		13,
		1,
		5,
		8,
		12,
		6,
		9,
		3,
		2,
		15,
		13,
		8,
		10,
		1,
		3,
		15,
		4,
		2,
		11,
		6,
		7,
		12,
		0,
		5,
		14,
		9
	],
	[
		10,
		0,
		9,
		14,
		6,
		3,
		15,
		5,
		1,
		13,
		12,
		7,
		11,
		4,
		2,
		8,
		13,
		7,
		0,
		9,
		3,
		4,
		6,
		10,
		2,
		8,
		5,
		14,
		12,
		11,
		15,
		1,
		13,
		6,
		4,
		9,
		8,
		15,
		3,
		0,
		11,
		1,
		2,
		12,
		5,
		10,
		14,
		7,
		1,
		10,
		13,
		0,
		6,
		9,
		8,
		7,
		4,
		15,
		14,
		3,
		11,
		5,
		2,
		12
	],
	[
		7,
		13,
		14,
		3,
		0,
		6,
		9,
		10,
		1,
		2,
		8,
		5,
		11,
		12,
		4,
		15,
		13,
		8,
		11,
		5,
		6,
		15,
		0,
		3,
		4,
		7,
		2,
		12,
		1,
		10,
		14,
		9,
		10,
		6,
		9,
		0,
		12,
		11,
		7,
		13,
		15,
		1,
		3,
		14,
		5,
		2,
		8,
		4,
		3,
		15,
		0,
		6,
		10,
		10,
		13,
		8,
		9,
		4,
		5,
		11,
		12,
		7,
		2,
		14
	],
	[
		2,
		12,
		4,
		1,
		7,
		10,
		11,
		6,
		8,
		5,
		3,
		15,
		13,
		0,
		14,
		9,
		14,
		11,
		2,
		12,
		4,
		7,
		13,
		1,
		5,
		0,
		15,
		10,
		3,
		9,
		8,
		6,
		4,
		2,
		1,
		11,
		10,
		13,
		7,
		8,
		15,
		9,
		12,
		5,
		6,
		3,
		0,
		14,
		11,
		8,
		12,
		7,
		1,
		14,
		2,
		13,
		6,
		15,
		0,
		9,
		10,
		4,
		5,
		3
	],
	[
		12,
		1,
		10,
		15,
		9,
		2,
		6,
		8,
		0,
		13,
		3,
		4,
		14,
		7,
		5,
		11,
		10,
		15,
		4,
		2,
		7,
		12,
		9,
		5,
		6,
		1,
		13,
		14,
		0,
		11,
		3,
		8,
		9,
		14,
		15,
		5,
		2,
		8,
		12,
		3,
		7,
		0,
		4,
		10,
		1,
		13,
		11,
		6,
		4,
		3,
		2,
		12,
		9,
		5,
		15,
		10,
		11,
		14,
		1,
		7,
		6,
		0,
		8,
		13
	],
	[
		4,
		11,
		2,
		14,
		15,
		0,
		8,
		13,
		3,
		12,
		9,
		7,
		5,
		10,
		6,
		1,
		13,
		0,
		11,
		7,
		4,
		9,
		1,
		10,
		14,
		3,
		5,
		12,
		2,
		15,
		8,
		6,
		1,
		4,
		11,
		13,
		12,
		3,
		7,
		14,
		10,
		15,
		6,
		8,
		0,
		5,
		9,
		2,
		6,
		11,
		13,
		8,
		1,
		4,
		10,
		7,
		9,
		5,
		0,
		15,
		14,
		2,
		3,
		12
	],
	[
		13,
		2,
		8,
		4,
		6,
		15,
		11,
		1,
		10,
		9,
		3,
		14,
		5,
		0,
		12,
		7,
		1,
		15,
		13,
		8,
		10,
		3,
		7,
		4,
		12,
		5,
		6,
		11,
		0,
		14,
		9,
		2,
		7,
		11,
		4,
		1,
		9,
		12,
		14,
		2,
		0,
		6,
		10,
		13,
		15,
		3,
		5,
		8,
		2,
		1,
		14,
		7,
		4,
		10,
		8,
		13,
		15,
		12,
		9,
		0,
		3,
		5,
		6,
		11
	]
];
const P_BOX = [
	16,
	7,
	20,
	21,
	29,
	12,
	28,
	17,
	1,
	15,
	23,
	26,
	5,
	18,
	31,
	10,
	2,
	8,
	24,
	14,
	32,
	27,
	3,
	9,
	19,
	13,
	30,
	6,
	22,
	11,
	4,
	25
];
const E_BOX_TABLE = [
	32,
	1,
	2,
	3,
	4,
	5,
	4,
	5,
	6,
	7,
	8,
	9,
	8,
	9,
	10,
	11,
	12,
	13,
	12,
	13,
	14,
	15,
	16,
	17,
	16,
	17,
	18,
	19,
	20,
	21,
	20,
	21,
	22,
	23,
	24,
	25,
	24,
	25,
	26,
	27,
	28,
	29,
	28,
	29,
	30,
	31,
	32,
	1
];
const KEY_RND_SHIFT = [
	1,
	1,
	2,
	2,
	2,
	2,
	2,
	2,
	1,
	2,
	2,
	2,
	2,
	2,
	2,
	1
];
const KEY_PERM_C = [
	56,
	48,
	40,
	32,
	24,
	16,
	8,
	0,
	57,
	49,
	41,
	33,
	25,
	17,
	9,
	1,
	58,
	50,
	42,
	34,
	26,
	18,
	10,
	2,
	59,
	51,
	43,
	35
];
const KEY_PERM_D = [
	62,
	54,
	46,
	38,
	30,
	22,
	14,
	6,
	61,
	53,
	45,
	37,
	29,
	21,
	13,
	5,
	60,
	52,
	44,
	36,
	28,
	20,
	12,
	4,
	27,
	19,
	11,
	3
];
const KEY_COMPRESSION = [
	13,
	16,
	10,
	23,
	0,
	4,
	2,
	27,
	14,
	5,
	20,
	9,
	22,
	18,
	11,
	3,
	25,
	7,
	15,
	6,
	26,
	19,
	12,
	1,
	40,
	51,
	30,
	36,
	46,
	54,
	29,
	39,
	50,
	44,
	32,
	47,
	43,
	48,
	38,
	55,
	33,
	52,
	45,
	41,
	49,
	35,
	28,
	31
];
//#endregion
//#region src/custom_des.ts
/**
* @internal
* @module custom_des
* @description
* 本模块包含了为解密 QRC 歌词而移植的、非标准的类 DES 算法的底层实现。
*
* <h2>
* <strong>警告：该 DES 实现并非标准实现！</strong>
* </h2>
*
* 它是结构类似DES的、但完全私有的分组密码算法。
* 本实现仅用于 QRC 歌词解密，不应用于实际安全目的。
*/
let Mode = /* @__PURE__ */ function(Mode) {
	Mode[Mode["Encrypt"] = 0] = "Encrypt";
	Mode[Mode["Decrypt"] = 1] = "Decrypt";
	return Mode;
}({});
/**
* 从8字节密钥中根据置换表提取位，生成一个 BigInt。
*
* 这个函数对应原始C代码中的天书BITNUM宏，模拟 QQ 音乐特有的非标准的字节序处理方式。
* 其将 8 字节密钥视为两个独立的、小端序的32位整数拼接而成。
*
* 例如，要读取第0位（MSB），它实际访问的是 `key[3]` 的最高位。
* 要读取第31位，它访问的是 `key[0]` 的最低位。
*
* @param key 8字节的密钥 Uint8Array
* @param table 0-based 的位索引置换表
*/
function permuteFromKeyBytes(key, table) {
	let output = 0n;
	let currentBitMask = 1n << BigInt(table.length - 1);
	for (let i = 0; i < table.length; i++) {
		const pos = table[i];
		const wordIndex = pos >> 5;
		const bitInWord = pos & 31;
		const byteInWord = bitInWord >> 3;
		const bitInByte = bitInWord & 7;
		if (key[wordIndex * 4 + 3 - byteInWord] >> 7 - bitInByte & 1) output |= currentBitMask;
		currentBitMask >>= 1n;
	}
	return output;
}
/**
* 对一个存储在 BigInt 中的28位密钥部分进行循环左移。
* @param value 包含28位数据的高位的 BigInt
* @param amount 左移的位数
*/
function rotateLeft28Bit(value, amount) {
	const BITS_28_MASK = 4294967280n;
	const val = value & BITS_28_MASK;
	return (val << BigInt(amount) | val >> BigInt(28 - amount)) & BITS_28_MASK;
}
/**
* DES 密钥调度算法。
* 从一个64位的主密钥（实际使用56位，每字节的最低位是奇偶校验位，被忽略）
* 生成16个48位的轮密钥。
*
* @param key 8字节的DES密钥
* @param mode 加密或解密模式
*/
function keySchedule(key, mode) {
	const schedule = new Int32Array(32);
	const c0 = permuteFromKeyBytes(key, KEY_PERM_C);
	const d0 = permuteFromKeyBytes(key, KEY_PERM_D);
	let c = c0 << 4n;
	let d = d0 << 4n;
	for (let i = 0; i < 16; i++) {
		const shift = KEY_RND_SHIFT[i];
		c = rotateLeft28Bit(c, shift);
		d = rotateLeft28Bit(d, shift);
		const toGen = mode === Mode.Decrypt ? 15 - i : i;
		let subkey48bit = 0n;
		for (let k = 0; k < KEY_COMPRESSION.length; k++) {
			const pos = KEY_COMPRESSION[k];
			if ((pos < 28 ? c >> BigInt(31 - pos) & 1n : d >> BigInt(31 - (pos - 27)) & 1n) === 1n) subkey48bit |= 1n << BigInt(47 - k);
		}
		const b5 = Number(subkey48bit >> 40n & 255n);
		const b4 = Number(subkey48bit >> 32n & 255n);
		const b3 = Number(subkey48bit >> 24n & 255n);
		const high24 = b5 << 16 | b4 << 8 | b3;
		const b2 = Number(subkey48bit >> 16n & 255n);
		const b1 = Number(subkey48bit >> 8n & 255n);
		const b0 = Number(subkey48bit & 255n);
		const low24 = b2 << 16 | b1 << 8 | b0;
		schedule[toGen * 2] = high24;
		schedule[toGen * 2 + 1] = low24;
	}
	return schedule;
}
const IP_RULE = [
	34,
	42,
	50,
	58,
	2,
	10,
	18,
	26,
	36,
	44,
	52,
	60,
	4,
	12,
	20,
	28,
	38,
	46,
	54,
	62,
	6,
	14,
	22,
	30,
	40,
	48,
	56,
	64,
	8,
	16,
	24,
	32,
	33,
	41,
	49,
	57,
	1,
	9,
	17,
	25,
	35,
	43,
	51,
	59,
	3,
	11,
	19,
	27,
	37,
	45,
	53,
	61,
	5,
	13,
	21,
	29,
	39,
	47,
	55,
	63,
	7,
	15,
	23,
	31
];
const INV_IP_RULE = [
	37,
	5,
	45,
	13,
	53,
	21,
	61,
	29,
	38,
	6,
	46,
	14,
	54,
	22,
	62,
	30,
	39,
	7,
	47,
	15,
	55,
	23,
	63,
	31,
	40,
	8,
	48,
	16,
	56,
	24,
	64,
	32,
	33,
	1,
	41,
	9,
	49,
	17,
	57,
	25,
	34,
	2,
	42,
	10,
	50,
	18,
	58,
	26,
	35,
	3,
	43,
	11,
	51,
	19,
	59,
	27,
	36,
	4,
	44,
	12,
	52,
	20,
	60,
	28
];
const IP_LEFT_TABLE = new Int32Array(2048);
const IP_RIGHT_TABLE = new Int32Array(2048);
const INV_IP_LEFT_TABLE = new Int32Array(2048);
const INV_IP_RIGHT_TABLE = new Int32Array(2048);
function generatePermutationTables() {
	const applyPermutation = (input, rule) => {
		let output = 0n;
		for (let i = 0; i < 64; i++) {
			const srcBit1Based = rule[i];
			if (input >> BigInt(64 - srcBit1Based) & 1n) output |= 1n << BigInt(63 - i);
		}
		return output;
	};
	for (let bytePos = 0; bytePos < 8; bytePos++) for (let byteVal = 0; byteVal < 256; byteVal++) {
		const permuted = applyPermutation(BigInt(byteVal) << BigInt(56 - bytePos * 8), IP_RULE);
		const idx = bytePos << 8 | byteVal;
		IP_LEFT_TABLE[idx] = Number(permuted >> 32n & 4294967295n);
		IP_RIGHT_TABLE[idx] = Number(permuted & 4294967295n);
	}
	for (let blockPos = 0; blockPos < 8; blockPos++) for (let blockVal = 0; blockVal < 256; blockVal++) {
		const permuted = applyPermutation(BigInt(blockVal) << BigInt(56 - blockPos * 8), INV_IP_RULE);
		const idx = blockPos << 8 | blockVal;
		INV_IP_LEFT_TABLE[idx] = Number(permuted >> 32n & 4294967295n);
		INV_IP_RIGHT_TABLE[idx] = Number(permuted & 4294967295n);
	}
}
generatePermutationTables();
/**
* 计算 DES S-盒的查找索引。
* @param a 一个包含6位数据的 u8
*/
function calculateSboxIndex(a) {
	return a & 32 | (a & 31) >> 1 | (a & 1) << 4;
}
/**
* 对一个 32 位整数应用非标准的 P 盒置换规则。
* @param input S-盒代换后的 32 位中间结果
*/
function applyQqPboxPermutation(input) {
	let output = 0;
	for (let i = 0; i < 32; i++) {
		const sourceBit1Based = P_BOX[i];
		const destBitMask = 1 << 31 - i;
		if ((input & 1 << 32 - sourceBit1Based) !== 0) output |= destBitMask;
	}
	return output;
}
const SP_TABLE = new Int32Array(512);
/**
* 生成 S-P 盒合并查找表以提高性能。
*/
function generateSpTables() {
	for (let sBoxIdx = 0; sBoxIdx < 8; sBoxIdx++) for (let sBoxInput = 0; sBoxInput < 64; sBoxInput++) {
		const sBoxIndex = calculateSboxIndex(sBoxInput);
		const prePBoxVal = S_BOXES[sBoxIdx][sBoxIndex] << 28 - sBoxIdx * 4;
		SP_TABLE[sBoxIdx << 6 | sBoxInput] = applyQqPboxPermutation(prePBoxVal);
	}
}
generateSpTables();
const EBOX_HIGH_TABLE = new Int32Array(1024);
const EBOX_LOW_TABLE = new Int32Array(1024);
function generateEBoxTables() {
	for (let chunkIdx = 0; chunkIdx < 4; chunkIdx++) {
		const shiftIn32 = (3 - chunkIdx) * 8;
		for (let byteVal = 0; byteVal < 256; byteVal++) {
			let high24 = 0;
			let low24 = 0;
			const input = byteVal << shiftIn32;
			for (let i = 0; i < 24; i++) if (input >>> 32 - E_BOX_TABLE[i] & 1) high24 |= 1 << 23 - i;
			for (let i = 24; i < 48; i++) if (input >>> 32 - E_BOX_TABLE[i] & 1) low24 |= 1 << 47 - i;
			const tableIdx = chunkIdx << 8 | byteVal;
			EBOX_HIGH_TABLE[tableIdx] = high24;
			EBOX_LOW_TABLE[tableIdx] = low24;
		}
	}
}
generateEBoxTables();
/**
* DES 的 F 函数。
*/
function fFunction(state, keyHigh24, keyLow24) {
	const b0 = state >>> 24 & 255;
	const b1 = state >>> 16 & 255;
	const b2 = state >>> 8 & 255;
	const b3 = state & 255;
	const eboxHigh24 = EBOX_HIGH_TABLE[b0] | EBOX_HIGH_TABLE[256 | b1] | EBOX_HIGH_TABLE[512 | b2] | EBOX_HIGH_TABLE[768 | b3];
	const eboxLow24 = EBOX_LOW_TABLE[b0] | EBOX_LOW_TABLE[256 | b1] | EBOX_LOW_TABLE[512 | b2] | EBOX_LOW_TABLE[768 | b3];
	const xorHigh24 = eboxHigh24 ^ keyHigh24;
	const xorLow24 = eboxLow24 ^ keyLow24;
	return SP_TABLE[xorHigh24 >>> 18 & 63] | SP_TABLE[64 | xorHigh24 >>> 12 & 63] | SP_TABLE[128 | xorHigh24 >>> 6 & 63] | SP_TABLE[192 | xorHigh24 & 63] | SP_TABLE[256 | xorLow24 >>> 18 & 63] | SP_TABLE[320 | xorLow24 >>> 12 & 63] | SP_TABLE[384 | xorLow24 >>> 6 & 63] | SP_TABLE[448 | xorLow24 & 63];
}
/**
* DES 加密/解密单个64位数据块。
*
* @param input 8字节的输入数据块 (明文或密文)。
* @param output 8字节的可变切片，用于存储输出数据块 (密文或明文)。
* @param keySchedule 一个包含16个轮密钥的向量的引用，每个轮密钥是6字节。
*/
function desCrypt(input, output, keySchedule) {
	let left = 0;
	let right = 0;
	for (let i = 0; i < 8; i++) {
		const idx = i << 8 | input[i];
		left |= IP_LEFT_TABLE[idx];
		right |= IP_RIGHT_TABLE[idx];
	}
	for (let i = 0; i < 15; i++) {
		const temp = right;
		right = (left ^ fFunction(right, keySchedule[i * 2], keySchedule[i * 2 + 1])) >>> 0;
		left = temp;
	}
	left = (left ^ fFunction(right, keySchedule[30], keySchedule[31])) >>> 0;
	let outLeft = 0;
	let outRight = 0;
	for (let i = 0; i < 4; i++) {
		const idxL = i << 8 | left >>> 24 - i * 8 & 255;
		outLeft |= INV_IP_LEFT_TABLE[idxL];
		outRight |= INV_IP_RIGHT_TABLE[idxL];
		const idxR = i + 4 << 8 | right >>> 24 - i * 8 & 255;
		outLeft |= INV_IP_LEFT_TABLE[idxR];
		outRight |= INV_IP_RIGHT_TABLE[idxR];
	}
	output[0] = outLeft >>> 24 & 255;
	output[1] = outLeft >>> 16 & 255;
	output[2] = outLeft >>> 8 & 255;
	output[3] = outLeft & 255;
	output[4] = outRight >>> 24 & 255;
	output[5] = outRight >>> 16 & 255;
	output[6] = outRight >>> 8 & 255;
	output[7] = outRight & 255;
}
//#endregion
//#region src/utils.ts
/**
* @module utils
* @description
*
* 包含一些工具函数。
*/
/**
* 将十六进制字符串转换为 Uint8Array。
*/
function hexToUint8Array(hex) {
	if (typeof Buffer !== "undefined") return Buffer.from(hex, "hex");
	if (hex.length % 2 !== 0) throw new Error("无效的十六进制字符串: 长度必须是偶数");
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
	return bytes;
}
/**
* 将 Uint8Array 转换为十六进制字符串。
*/
function uint8ArrayToHex(bytes) {
	if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("hex");
	return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
//#endregion
//#region src/qrc_codec.ts
/**
* @module qrc-codec
* @description
* 此模块是加密与解密 QRC 歌词的核心。
* 提供了两个主要的公共函数：`decryptQrc` 和 `encryptQrc`。
*
* 非标准 3DES 算法实现由 `custom_des` 模块提供。
*/
const DES_BLOCK_SIZE = 8;
/**
* 非标准 3DES 编解码器
*/
var QqMusicCodec = class {
	encryptSchedule;
	decryptSchedule;
	constructor() {
		this.decryptSchedule = [
			keySchedule(KEY_3, Mode.Decrypt),
			keySchedule(KEY_2, Mode.Encrypt),
			keySchedule(KEY_1, Mode.Decrypt)
		];
		this.encryptSchedule = [
			keySchedule(KEY_1, Mode.Encrypt),
			keySchedule(KEY_2, Mode.Decrypt),
			keySchedule(KEY_3, Mode.Encrypt)
		];
	}
	/**
	* 解密一个8字节的数据块。
	*/
	decryptBlock(input, output) {
		const temp1 = new Uint8Array(8);
		const temp2 = new Uint8Array(8);
		desCrypt(input, temp1, this.decryptSchedule[0]);
		desCrypt(temp1, temp2, this.decryptSchedule[1]);
		desCrypt(temp2, output, this.decryptSchedule[2]);
	}
	/**
	* 加密一个8字节的数据块。
	*/
	encryptBlock(input, output) {
		const temp1 = new Uint8Array(8);
		const temp2 = new Uint8Array(8);
		desCrypt(input, temp1, this.encryptSchedule[0]);
		desCrypt(temp1, temp2, this.encryptSchedule[1]);
		desCrypt(temp2, output, this.encryptSchedule[2]);
	}
};
const CODEC = new QqMusicCodec();
/**
* 使用零字节对数据进行填充。
*
* QQ音乐使用的填充方案是零填充。
* @param data 需要填充的字节数据
* @param blockSize 块大小，对于DES来说是8
*/
function zeroPad(data, blockSize) {
	const paddingLen = (blockSize - data.length % blockSize) % blockSize;
	if (paddingLen === 0) return data;
	const paddedData = new Uint8Array(data.length + paddingLen);
	paddedData.set(data, 0);
	return paddedData;
}
/**
* 使用 Zlib 解压缩字节数据。
* 同时会尝试移除头部的 UTF-8 BOM (0xEF 0xBB 0xBF)。
*/
function decompress(data) {
	const chunks = []; let length = 0;
 const decoder = new Inflate({ chunkSize: 16384 });
 decoder.onData = chunk => { length += chunk.length; if (length > 1048576) throw Error("QRC output too large"); chunks.push(chunk); };
 decoder.push(data, true);
 if (decoder.err) throw Error("Invalid QRC compression");
 const decompressed = new Uint8Array(length); let offset = 0;
 for (const chunk of chunks) { decompressed.set(chunk, offset); offset += chunk.length; }
	if (decompressed.length >= 3 && decompressed[0] === 239 && decompressed[1] === 187 && decompressed[2] === 191) return decompressed.slice(3);
	return decompressed;
}
/**
* 解密十六进制字符串格式的 Qrc 歌词数据
* 解密后可去头尾 XML 数据后通过调用 `parseQrc` 解析歌词行
* @param hexData 十六进制格式的字符串，代表被加密的歌词数据
* @returns 被解密出来的歌词字符串，是前后有 XML 混合的 QRC 歌词
*/
function decryptQrc(encryptedHexString) {
	if (encryptedHexString.length > 2097152 || !/^[a-f0-9]+$/i.test(encryptedHexString)) throw Error("Invalid QRC input");
 const encryptedBytes = hexToUint8Array(encryptedHexString);
	if (encryptedBytes.length % DES_BLOCK_SIZE !== 0) throw new Error(`加密数据长度不是${DES_BLOCK_SIZE}的倍数`);
	const decryptedData = new Uint8Array(encryptedBytes.length);
	for (let i = 0; i < encryptedBytes.length; i += DES_BLOCK_SIZE) {
		const chunk = encryptedBytes.subarray(i, i + DES_BLOCK_SIZE);
		const outChunk = decryptedData.subarray(i, i + DES_BLOCK_SIZE);
		CODEC.decryptBlock(chunk, outChunk);
	}
	const decompressedBytes = decompress(decryptedData);
	return new TextDecoder("utf-8").decode(decompressedBytes);
}
/**
* 对明文执行加密操作。
* @param plaintext 明文字符串
* @returns 十六进制格式的字符串，代表被加密的歌词数据
*/
function encryptQrc(plaintext) {
	const paddedData = zeroPad(deflate(new TextEncoder().encode(plaintext)), DES_BLOCK_SIZE);
	const encryptedData = new Uint8Array(paddedData.length);
	for (let i = 0; i < paddedData.length; i += DES_BLOCK_SIZE) {
		const chunk = paddedData.subarray(i, i + DES_BLOCK_SIZE);
		const outChunk = encryptedData.subarray(i, i + DES_BLOCK_SIZE);
		CODEC.encryptBlock(chunk, outChunk);
	}
	return uint8ArrayToHex(encryptedData);
}
//#endregion
export { decryptQrc, encryptQrc };
