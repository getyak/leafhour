#!/usr/bin/env python3
"""Check the marked light-theme 402x874 reader benchmark recording.

Usage: check-reader-video.py RECORDING.mp4 REPORT.json
Requires ffmpeg. Encoded Simulator samples do not certify physical display frames.
"""

import argparse
import json
from pathlib import Path
import shutil
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        parser.error("ffmpeg is required")
    width, height = 402, 874
    process = subprocess.Popen(
        [ffmpeg, "-v", "error", "-i", str(args.video), "-vf",
         f"scale={width}:{height}", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
        stdout=subprocess.PIPE,
    )
    frame_size = width * height * 3
    index, rows = 0, []
    while True:
        data = process.stdout.read(frame_size)
        if len(data) != frame_size:
            break
        green = 0
        for y in range(4, 14):
            for x in range(4, 14):
                offset = (y * width + x) * 3
                red, green_channel, blue = data[offset:offset + 3]
                green += green_channel > 180 and red < 75 and blue < 95
        if green >= 30:
            ink, light = 0, 0
            for y in range(72, 640, 2):
                for x in range(24, 366, 2):
                    offset = (y * width + x) * 3
                    pixel = data[offset:offset + 3]
                    ink += max(pixel) < 155
                    light += min(pixel) > 210
            rows.append({"frame": index, "markerPixels": green,
                         "inkSamples": ink, "lightSamples": light})
        index += 1
    code = process.wait()
    if code or not rows:
        raise SystemExit("Recording decode failed or no active marker frames were observed")
    result = {
        "source": "Simulator screen recording, every encoded frame with the test-only green marker",
        "encodedFrames": index,
        "activeFrames": len(rows),
        "blankActiveFrames": sum(row["inkSamples"] < 30 or row["lightSamples"] < 2000 for row in rows),
        "minimumInkSamples": min(row["inkSamples"] for row in rows),
        "minimumLightSamples": min(row["lightSamples"] for row in rows),
        "frames": rows,
        "physicalDeviceAcceptance": False,
        "note": "Encoded Simulator video frames are samples; this is not physical-device refresh-rate certification.",
    }
    args.output.write_text(json.dumps(result, indent=2))
    print(json.dumps({key: value for key, value in result.items() if key != "frames"}))
    if result["blankActiveFrames"]:
        raise SystemExit("Blank white or black active frames detected")


if __name__ == "__main__":
    main()
