// swift-tools-version: 5.9
import PackageDescription
let package = Package(
    name: "swift-cmark",
    products: [
        .library(name: "cmark-gfm", targets: ["cmark-gfm"]),
        .library(name: "cmark-gfm-extensions", targets: ["cmark-gfm-extensions"])
    ],
    targets: [
        .target(name: "cmark-gfm", path: "src", cSettings: [.define("CMARK_THREADING")]),
        .target(name: "cmark-gfm-extensions", dependencies: ["cmark-gfm"], path: "extensions", cSettings: [.define("CMARK_THREADING")])
    ]
)
