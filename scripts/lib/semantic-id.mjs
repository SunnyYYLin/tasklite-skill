import { parseCanonicalDateTime, todayString } from "./dates.mjs";

const pinyinCollator = new Intl.Collator("zh-CN-u-co-pinyin");

// Boundary characters per Mandarin pinyin initial ordered monotonically across Node & Bun ICU collators
const PINYIN_INITIAL_ANCHORS = [
	["a", "阿"],
	["b", "八"],
	["c", "嚓"],
	["d", "耷"],
	["e", "妸"],
	["f", "发"],
	["g", "旮"],
	["h", "哈"],
	["j", "讥"],
	["k", "咔"],
	["l", "垃"],
	["m", "妈"],
	["n", "拿"],
	["o", "噢"],
	["p", "趴"],
	["q", "七"],
	["r", "然"],
	["s", "仨"],
	["t", "他"],
	["w", "挖"],
	["x", "夕"],
	["y", "丫"],
	["z", "匝"],
];

export function getPinyinInitial(ch) {
	// Binary search over monotonic anchors
	let lo = 0;
	let hi = PINYIN_INITIAL_ANCHORS.length - 1;
	let matched = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (pinyinCollator.compare(ch, PINYIN_INITIAL_ANCHORS[mid][1]) >= 0) {
			matched = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return matched >= 0 ? PINYIN_INITIAL_ANCHORS[matched][0] : "a";
}

function generateRandom(length) {
	let str = "";
	while (str.length < length) {
		str += Math.random().toString(36).substring(2);
	}
	return str.substring(0, length);
}

/**
 * Generate a semantic ID from the task description (max 8 base chars),
 * appending `-${dueDate}` for recurring tasks and `-${rand4}` on vault collision.
 */
export function generateSemanticId(description, options = {}) {
	const clean = String(description ?? "")
		.replace(/#[^\s!@#$%^&*(),.?":{}|<>]+/gu, "")
		.trim();

	const tokens = [];
	let currentWord = "";

	for (let i = 0; i < clean.length; i++) {
		const char = clean[i];
		if (/[\u4e00-\u9fa5]/u.test(char)) {
			if (currentWord) {
				tokens.push(currentWord[0].toLowerCase());
				currentWord = "";
			}
			tokens.push(getPinyinInitial(char));
		} else if (/[a-zA-Z0-9]/u.test(char)) {
			currentWord += char;
		} else if (currentWord) {
			tokens.push(currentWord[0].toLowerCase());
			currentWord = "";
		}
	}
	if (currentWord) {
		tokens.push(currentWord[0].toLowerCase());
	}

	const filtered = tokens.filter(Boolean);
	let base = filtered.length > 0 ? filtered.join("").slice(0, 8) : "";
	if (!base) {
		base = generateRandom(8);
	}

	if (options.isRecurring) {
		const rawDue = options.dueDate;
		const dateSuffix = rawDue
			? (parseCanonicalDateTime(rawDue)?.date ?? rawDue.trim().split(/[ T]/)[0])
			: todayString();
		base = `${base}-${dateSuffix}`;
	}

	let finalId = base;
	if (options.existingIds) {
		let attempts = 0;
		while (options.existingIds.has(finalId) && attempts < 1000) {
			attempts++;
			finalId = `${base}-${generateRandom(4)}`;
		}
	}

	return finalId;
}
