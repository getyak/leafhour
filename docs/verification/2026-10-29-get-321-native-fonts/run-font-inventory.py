#!/usr/bin/env python3
"""Run only inside dev-ios-session. Register a root after the guard is owned."""
from pathlib import Path
import hashlib
import json
import os
import subprocess

source = Path(__file__).with_name("font-inventory.m").resolve()
subprocess.run(["dev-ios-session", "is-owner"], check=True)
if (Path.home() / ".agent-pause").exists():
    raise SystemExit("Operations pause exists; native work deferred.")
udid = os.environ["IOS_SIMULATOR_ID"]
root = Path(subprocess.check_output(
    ["dev-storage-guard", "new-artifact", "GET-321-font-inventory"], text=True).strip())
print(json.dumps({"registeredArtifact": str(root)}), flush=True)
source_copy = root / source.name
source_copy.write_bytes(source.read_bytes())
(root / Path(__file__).name).write_bytes(Path(__file__).read_bytes())
sdk = subprocess.check_output(
    ["xcrun", "--sdk", "iphonesimulator", "--show-sdk-path"], text=True).strip()
sdk_version = subprocess.check_output(
    ["xcrun", "--sdk", "iphonesimulator", "--show-sdk-version"], text=True).strip()
binary = root / "font-inventory"
cmd = ["xcrun", "--sdk", "iphonesimulator", "clang",
       "-target", "arm64-apple-ios17.0-simulator", "-isysroot", sdk,
       "-fobjc-arc", "-Wall", "-Wextra", "-Werror", "-O0",
       "-framework", "UIKit", "-framework", "CoreText",
       "-framework", "Foundation", str(source_copy), "-o", str(binary)]
record = {"udid": udid, "sdkVersion": sdk_version, "compileCommand": cmd,
          "probeSHA256": hashlib.sha256(source.read_bytes()).hexdigest(),
          "executionStatus": "started",
          "scope": "No app build, installation, app data, system preference or network setting mutation."}
(root / "execution.json").write_text(json.dumps(record, indent=2) + "\n")
try:
    with (root / "compile.log").open("w") as log:
        subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=60)
    with (root / "inventory.json").open("w") as out, (root / "runtime.stderr").open("w") as err:
        subprocess.run(["xcrun", "simctl", "spawn", udid, str(binary)],
                       stdout=out, stderr=err, check=True, timeout=60)
    data = json.loads((root / "inventory.json").read_text())
    assert data["schema"] == 1 and data["uiFamilies"] and data["fontLoads"]
    assert data["coreTextAvailablePostScriptNames"]
    assert len(data["currentSerifSampleTraces"]) == 28
    assert data["observedRunUIFontLoads"]
    assert all(item["uiFontConstructed"] for item in data["fontLoads"])
    assert all(item["resolvedNameMatchesRequest"] for item in data["fontLoads"])
    assert any(item["observedRunName"] == "HiraMinProN-W3"
               and item["resolvedNameMatchesObservedRun"]
               for item in data["observedRunUIFontLoads"])
    for trace in data["currentSerifSampleTraces"]:
        assert trace["runs"] and trace["requestedFont"]["postScriptName"]
        for run in trace["runs"]:
            assert run["utf16Location"] >= 0 and run["utf16Length"] >= 0
            assert run["utf16Location"] + run["utf16Length"] <= trace["utf16Length"]
    record.update(executionStatus="passed",
                  uiFamilyCount=len(data["uiFamilies"]),
                  testedNameCount=len(data["fontLoads"]),
                  constructedNameCount=sum(item["uiFontConstructed"] for item in data["fontLoads"]),
                  exactNameCount=sum(item["resolvedNameMatchesRequest"] for item in data["fontLoads"]),
                  traceCount=len(data["currentSerifSampleTraces"]),
                  inventorySHA256=hashlib.sha256((root / "inventory.json").read_bytes()).hexdigest())
except BaseException as error:
    record.update(executionStatus="failed", errorType=type(error).__name__, error=str(error))
    raise
finally:
    (root / "execution.json").write_text(json.dumps(record, indent=2) + "\n")
print(json.dumps({"artifact": str(root), "execution": record}), flush=True)
