"""Small source-shaped fixtures for the offline Chinese classics importer."""

from pathlib import Path
import importlib.util
import re
import unittest

from bs4 import BeautifulSoup


MODULE = Path(__file__).resolve().parents[1] / "tools" / "classic_chinese.py"
if MODULE.exists():
    spec = importlib.util.spec_from_file_location("classic_chinese", MODULE)
    classic_chinese = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(classic_chinese)
else:
    classic_chinese = None


def page(body):
    return (
        '<html><body><header id="pg-header">Gutenberg source credit</header>'
        + body
        + '<footer id="pg-footer">Gutenberg complete licence</footer></body></html>'
    ).encode("utf-8")


def compact(value):
    return re.sub(r"\s+", "", value)


def output_text(result):
    return "".join(
        "".join(chapter["sourceHeadings"]) + "".join(chapter["paragraphs"])
        for chapter in result["chapters"]
    )


class ChineseClassicTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(classic_chinese, "Chinese source extraction is not implemented")

    def assert_source_preserved(self, pg_id, raw, part=None):
        scope = classic_chinese.source_scope(pg_id, raw, part)
        original = BeautifulSoup(scope, "html.parser").get_text()
        result = classic_chinese.extract(pg_id, raw, part)
        self.assertEqual(compact(output_text(result)), compact(original))
        return result

    def test_analects_excludes_editor_note_but_retains_source_notices(self):
        raw = page(
            '<p id="id00000">Produced by source volunteer</p>'
            '<p id="id00001">An editorial correction, outside the work.</p>'
            '<p id="id00002">學而第一</p><p id="id00003">1. 子曰：「學而時習之。」</p>'
            '<p>為政第二</p><p>1. 子曰：「為政以德。」</p>'
        )
        result = self.assert_source_preserved(23839, raw)
        self.assertEqual([c["title"] for c in result["chapters"]], ["學而第一", "為政第二"])
        self.assertEqual(result["chapters"][0]["paragraphs"], ["1. 子曰：「學而時習之。」"])
        self.assertNotIn("correction", output_text(result))
        self.assertEqual(result["notices"], "Gutenberg source credit\n\nGutenberg complete licence")

    def test_scope_is_the_unchanged_html_range_including_inline_markup(self):
        body = '<p id="id00002">學而第一</p><p>子曰：<em>信</em>&amp;義□。</p>'
        raw = page('<p id="id00000">Producer</p><p id="id00001">Note</p>' + body)
        self.assertEqual(classic_chinese.source_scope(23839, raw), body)
        result = self.assert_source_preserved(23839, raw)
        self.assertEqual(compact(result["chapters"][0]["paragraphs"][0]), "子曰：信&義□。")

    def test_mencius_splits_multiple_upper_and_lower_books_inside_one_p(self):
        raw = page(
            '<p id="id00000">Producer</p><p id="id00001">Uploader instructions</p>'
            '<p id="id00002">Fictional upload metadata; never author prose.</p>'
            '<p id="id00003">卷之一梁惠王上\n　　一\n　　孟子見梁惠王。\n'
            '王曰：「何以利吾國？」\n卷之一梁惠王下\n　　一\n　　孟子曰：「王之好樂甚。」</p>'
        )
        result = self.assert_source_preserved(24178, raw)
        self.assertEqual([c["title"] for c in result["chapters"]], ["卷之一梁惠王上", "卷之一梁惠王下"])
        self.assertEqual(result["chapters"][1]["paragraphs"], ["一", "孟子曰：「王之好樂甚。」"])
        self.assertNotIn("metadata", classic_chinese.source_scope(24178, raw))

    def test_zhuangzi_finds_heading_after_previous_prose_inside_one_p(self):
        raw = page(
            '<p id="id00000">Producer</p><p id="id00001">逍遙遊第一</p>'
            '<p>北冥有魚，其名為鯤。\n知北游第二十二　　知北游於玄水之上。\n'
            '　　無為謂曰：「未知。」</p>'
        )
        result = self.assert_source_preserved(23913, raw)
        self.assertEqual([c["title"] for c in result["chapters"]], ["逍遙遊第一", "知北游第二十二"])
        self.assertEqual(result["chapters"][1]["sourceHeadings"], ["知北游第二十二"])
        self.assertEqual(result["chapters"][0]["paragraphs"], ["北冥有魚，其名為鯤。"])

    def test_sunzi_preserves_punctuation_lacunae_and_body_paragraphs(self):
        raw = page(
            '<p id="id00000">Producer</p><p id="id00001">始計第一</p>'
            '<p>孫子曰：兵者，國之大事，□不可不察也。</p>'
            '<p>故經之以五事。</p><p>作戰第二</p><p>孫子曰：凡用兵之法。</p>'
        )
        result = self.assert_source_preserved(23864, raw)
        self.assertEqual(result["chapters"][0]["paragraphs"], ["孫子曰：兵者，國之大事，□不可不察也。", "故經之以五事。"])

    def test_daodejing_keeps_internal_part_labels_and_chapter_81(self):
        raw = page(
            '<p id="id00000">Producer</p><p id="id00001">An obsolete range label</p>'
            '<p id="id00002">老子道經</p><p>第一章</p><p>道可道，非常道。</p>'
            '<p>老子德經</p><p>第三十八章</p><p>上德不德，是以有德。</p>'
            '<p>第八十一章</p><p>為而不爭。</p>'
        )
        result = self.assert_source_preserved(7337, raw)
        self.assertEqual([c["title"] for c in result["chapters"]], ["第一章", "第三十八章", "第八十一章"])
        self.assertIn("老子道經", "".join(result["chapters"][0]["sourceHeadings"]))
        self.assertIn("老子德經", "".join(result["chapters"][1]["sourceHeadings"]))
        self.assertNotIn("obsolete", output_text(result))

    def test_red_chamber_preserves_duplicate_heading_blocks_without_duplicate_chapter(self):
        raw = page(
            '<p id="id00000">第四十一回　茶品梅花雪　怡紅院遇客\n———\n'
            '話說劉姥姥笑道：「第二回了。」\n第四十五回　金蘭契互剖金蘭語　風雨夕悶制風雨詞\n———</p>'
            '<p>第四十五回　金蘭契互剖金蘭語　風雨夕悶制風雨詞</p><p>————</p>'
            '<p>　　話說鳳姐兒正撫恤平兒。□</p>'
        )
        result = self.assert_source_preserved(24264, raw)
        self.assertEqual(len(result["chapters"]), 2)
        repeated = result["chapters"][1]
        self.assertEqual(len(repeated["sourceHeadings"]), 2)
        self.assertEqual(repeated["title"], "第四十五回 金蘭契互剖金蘭語 風雨夕悶制風雨詞")
        self.assertEqual(repeated["paragraphs"], ["話說鳳姐兒正撫恤平兒。□"])
        self.assertEqual(output_text(result).count("撫恤平兒"), 1)

    def test_red_chamber_separate_subtitle_and_inline_body_remain_in_sequence(self):
        raw = page(
            '<p id="id00000">第三回</p><p>———</p><p>賈雨村夤緣復舊職　林黛玉拋父進京都</p>'
            '<p>　　卻說雨村忙回頭看時。</p>'
            '<p>第一零四回　醉金剛小鰍生大浪　痴公子餘痛觸前情 話說賈雨村剛欲過渡，</p>'
            '<p>仍舊問了一聲。</p>'
        )
        result = self.assert_source_preserved(24264, raw)
        self.assertEqual(result["chapters"][0]["title"], "第三回 賈雨村夤緣復舊職 林黛玉拋父進京都")
        self.assertEqual(result["chapters"][1]["title"], "第一零四回 醉金剛小鰍生大浪 痴公子餘痛觸前情")
        self.assertTrue(result["chapters"][1]["paragraphs"][0].startswith("話說賈雨村"))

    def test_red_chamber_parts_cut_inside_p_without_losing_adjacent_chapters(self):
        raw = page(
            '<p id="id00000">第一回　開卷題　另一題\n甲。\n第四十回　園中題　另一題\n乙。\n'
            '第四十一回　新卷題　另一題\n丙。\n第八十回　故園題　另一題\n丁。\n'
            '第八十一回　續卷題　另一題\n戊。\n第一二零回　終卷題　另一題\n己。</p>'
        )
        all_results = []
        for part, titles, body in [(1, ["第一回 開卷題 另一題", "第四十回 園中題 另一題"], "甲。乙。"), (2, ["第四十一回 新卷題 另一題", "第八十回 故園題 另一題"], "丙。丁。"), (3, ["第八十一回 續卷題 另一題", "第一二零回 終卷題 另一題"], "戊。己。")]:
            result = self.assert_source_preserved(24264, raw, part)
            self.assertEqual([c["title"] for c in result["chapters"]], titles)
            self.assertEqual("".join(p for c in result["chapters"] for p in c["paragraphs"]), body)
            all_results.append(output_text(result))
        self.assertEqual(classic_chinese.source_scope(24264, raw, 2), "第四十一回　新卷題　另一題\n丙。\n第八十回　故園題　另一題\n丁。\n")
        self.assertEqual(compact("".join(all_results)), compact(output_text(classic_chinese.extract(24264, raw))))

    def test_unknown_ids_invalid_parts_and_missing_source_boundaries_are_rejected(self):
        valid = page('<p id="id00002">學而第一</p><p>子曰：「信。」</p>')
        for pg_id, part in [(99999, None), (True, None), (23839, 1), (24264, 0), (24264, 4), (24264, True), (24264, "1")]:
            for function in [classic_chinese.extract, classic_chinese.source_scope]:
                with self.subTest(pg_id=pg_id, part=part, function=function.__name__):
                    with self.assertRaises((ValueError, TypeError)):
                        function(pg_id, valid, part)
        with self.assertRaises(ValueError):
            classic_chinese.extract(23839, page('<p>Unrecognized source wrapper.</p>'))
        with self.assertRaises(ValueError):
            classic_chinese.source_scope(24264, page('<p id="id00000">第一回　開卷題\n甲。</p>'), 2)


if __name__ == "__main__":
    unittest.main()
