import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { setTodayOverride } from "../scripts/lib/dates.mjs";
import { generateSemanticId, getPinyinInitial } from "../scripts/lib/semantic-id.mjs";

describe("semantic ID generation & pinyin collator", () => {
	afterEach(() => {
		setTodayOverride(null);
	});

	test("matches obsidian-tasklite core semantic ID expectations", () => {
		assert.equal(generateSemanticId("feat: support blocking and ID"), "fsbai");
		assert.equal(generateSemanticId("自动生成带语义ID（英语+hyphen，中文拼音）"), "zdscdyyi");
		assert.equal(generateSemanticId("feat: 添加API返回assignee集合"), "ftjafhaj");

		const emptyId = generateSemanticId("");
		assert.equal(emptyId.length, 8);
		assert.match(emptyId, /^[a-z0-9]{8}$/);
	});

	test("strips inline tags and handles common Chinese initials accurately", () => {
		assert.equal(generateSemanticId("写周报 #work #weekly"), "xzb");
		assert.equal(generateSemanticId("测试站会"), "cszh");
		assert.equal(generateSemanticId("转移NAS到ZGCA"), "zyndz");

		const samples = [
			["啊", "a"],
			["巴", "b"],
			["擦", "c"],
			["大", "d"],
			["鹅", "e"],
			["发", "f"],
			["高", "g"],
			["哈", "h"],
			["家", "j"],
			["开", "k"],
			["来", "l"],
			["马", "m"],
			["拿", "n"],
			["哦", "o"],
			["怕", "p"],
			["七", "q"],
			["人", "r"],
			["三", "s"],
			["他", "t"],
			["我", "w"],
			["西", "x"],
			["压", "y"],
			["在", "z"],
		];
		for (const [ch, expected] of samples) {
			assert.equal(getPinyinInitial(ch), expected, `Expected "${ch}" -> "${expected}"`);
		}
	});

	test("appends date suffix for recurring tasks and respects --today fallback", () => {
		assert.equal(
			generateSemanticId("feat: support blocking", {
				isRecurring: true,
				dueDate: "2026-06-13",
			}),
			"fsb-2026-06-13",
		);
		assert.equal(
			generateSemanticId("feat: support blocking", {
				isRecurring: true,
				dueDate: "2026-06-13 18:30",
			}),
			"fsb-2026-06-13",
		);

		setTodayOverride("2026-11-10");
		assert.equal(
			generateSemanticId("feat: support blocking", { isRecurring: true }),
			"fsb-2026-11-10",
		);
	});

	test("resolves collisions against existing vault IDs with 4-char random suffix", () => {
		const existingIds = new Set(["fsb", "fsb-2026-06-13"]);

		const normalId = generateSemanticId("feat: support blocking", { existingIds });
		assert.notEqual(normalId, "fsb");
		assert.match(normalId, /^fsb-[a-z0-9]{4}$/);

		const recurringId = generateSemanticId("feat: support blocking", {
			isRecurring: true,
			dueDate: "2026-06-13",
			existingIds,
		});
		assert.notEqual(recurringId, "fsb-2026-06-13");
		assert.match(recurringId, /^fsb-2026-06-13-[a-z0-9]{4}$/);
	});
});
