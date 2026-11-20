"""
Typendo Analytics & Corpus Engine (Python Module)
=================================================
Project-Based Subject: Python
Author: GIRIDHARAN N S (Reg No: 12601069, Roll No: 03, Section: E1P2604)

This module provides backend data processing, natural language text analysis,
readability scoring, and keystroke telemetry anti-cheat verification for the
Typendo browser-based typing battle platform.
"""

import math
import re
import json
import statistics
from typing import List, Dict, Any, Tuple


class TextAnalyzer:
    """Analyzes race texts to assess reading difficulty, syllable density, and typing ergonomics."""

    @staticmethod
    def count_syllables(word: str) -> int:
        word = word.lower().strip()
        if len(word) <= 3:
            return 1
        word = re.sub(r'(?:[^laeiouy]|ed|es|e)$', '', word)
        word = re.sub(r'^y', '', word)
        matches = re.findall(r'[aeiouy]{1,2}', word)
        return max(1, len(matches))

    @classmethod
    def analyze_passage(cls, text: str) -> Dict[str, Any]:
        words = re.findall(r'\b[A-Za-z0-9\'-]+\b', text)
        sentences = re.split(r'[.!?]+', text)
        sentences = [s.strip() for s in sentences if s.strip()]

        total_words = len(words)
        total_chars = sum(len(w) for w in words)
        total_sentences = max(1, len(sentences))
        total_syllables = sum(cls.count_syllables(w) for w in words)

        # Metrics computation
        avg_word_length = total_chars / total_words if total_words > 0 else 0
        avg_sentence_length = total_words / total_sentences

        # Flesch-Kincaid Grade Level
        # FKGL = 0.39 * (total_words / total_sentences) + 11.8 * (total_syllables / total_words) - 15.59
        fkgl = (0.39 * avg_sentence_length) + (11.8 * (total_syllables / max(1, total_words))) - 15.59
        fkgl = max(0.0, round(fkgl, 2))

        # Typing Difficulty Tier: 1 (Novice) to 5 (Grandmaster)
        if fkgl <= 4.0 and avg_word_length < 4.5:
            tier = "Bronze / Casual"
        elif fkgl <= 7.0:
            tier = "Silver / Intermediate"
        elif fkgl <= 10.0:
            tier = "Gold / Advanced"
        elif fkgl <= 13.0:
            tier = "Platinum / Elite"
        else:
            tier = "Diamond / Grandmaster"

        return {
            "word_count": total_words,
            "character_count": total_chars,
            "sentence_count": total_sentences,
            "syllable_count": total_syllables,
            "avg_word_length": round(avg_word_length, 2),
            "flesch_kincaid_grade": fkgl,
            "recommended_tier": tier,
        }


class TelemetryAntiCheatGuard:
    """Evaluates raw keystroke time-series deltas to detect automated bots or copy-paste macros."""

    HUMAN_MIN_DELTA_MS = 25.0       # Fastest human finger transition between distinct keys
    INHUMAN_BURST_CPM = 1200.0      # ~240 WPM sustained burst threshold

    @classmethod
    def evaluate_keystrokes(cls, timestamps_ms: List[float]) -> Dict[str, Any]:
        if len(timestamps_ms) < 5:
            return {"status": "INSUFFICIENT_DATA", "is_flagged": False, "confidence": 0.0}

        deltas = [timestamps_ms[i] - timestamps_ms[i - 1] for i in range(1, len(timestamps_ms))]
        deltas = [d for d in deltas if d >= 0]

        if not deltas:
            return {"status": "INVALID_TELEMETRY", "is_flagged": True, "confidence": 1.0}

        mean_delta = statistics.mean(deltas)
        stdev_delta = statistics.stdev(deltas) if len(deltas) > 1 else 0.0
        min_delta = min(deltas)

        # Average CPM calculation from deltas
        avg_cpm = (60000.0 / mean_delta) if mean_delta > 0 else 9999.0

        flags = []
        if min_delta < cls.HUMAN_MIN_DELTA_MS:
            flags.append(f"Sub-human key interval detected: {min_delta:.1f}ms (threshold: {cls.HUMAN_MIN_DELTA_MS}ms)")
        if avg_cpm > cls.INHUMAN_BURST_CPM:
            flags.append(f"Inhuman keystroke velocity: {avg_cpm:.1f} CPM (threshold: {cls.INHUMAN_BURST_CPM} CPM)")
        if stdev_delta < 4.0 and len(deltas) > 15:
            flags.append("Unnatural rhythmic uniformity (bot-like zero variance)")

        is_flagged = len(flags) > 0
        confidence = min(1.0, 0.4 * len(flags) + (0.5 if avg_cpm > cls.INHUMAN_BURST_CPM else 0.0))

        return {
            "status": "FLAGGED" if is_flagged else "CLEAN",
            "is_flagged": is_flagged,
            "average_cpm": round(avg_cpm, 1),
            "estimated_wpm": round(avg_cpm / 5.0, 1),
            "mean_delta_ms": round(mean_delta, 2),
            "stdev_delta_ms": round(stdev_delta, 2),
            "min_delta_ms": round(min_delta, 2),
            "anomaly_flags": flags,
            "confidence_score": round(confidence, 2)
        }


def run_benchmark_demo():
    print("==================================================")
    print("Typendo Python Analytics & Verification Engine")
    print("Project Subject: Python | Author: GIRIDHARAN N S")
    print("==================================================")

    sample_passage = (
        "The browser-based typing duel engine synchronizes real-time "
        "gameplay state across bidirectional WebSockets, delivering low-latency "
        "competitive racing directly to modern web interfaces."
    )

    print("\n--- [1] Text Difficulty & Readability Analysis ---")
    metrics = TextAnalyzer.analyze_passage(sample_passage)
    print(json.dumps(metrics, indent=2))

    print("\n--- [2] Telemetry Anti-Cheat Evaluation (Simulated Human) ---")
    human_times = [0, 85, 172, 260, 395, 480, 560, 680, 790, 920, 1010, 1140]
    human_res = TelemetryAntiCheatGuard.evaluate_keystrokes(human_times)
    print("Human Race Telemetry Result:", human_res["status"], f"(Est WPM: {human_res['estimated_wpm']})")

    print("\n--- [3] Telemetry Anti-Cheat Evaluation (Simulated Bot Macro) ---")
    bot_times = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110]
    bot_res = TelemetryAntiCheatGuard.evaluate_keystrokes(bot_times)
    print("Bot Macro Telemetry Result:", bot_res["status"], f"(Flags: {bot_res['anomaly_flags']})")
    print("==================================================")


if __name__ == "__main__":
    run_benchmark_demo()

