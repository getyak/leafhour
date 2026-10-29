import SwiftUI
import LeafhourCore
@main struct LeafhourGET315ProbeApp: App {
 @State private var model = LibraryModel(root: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("GET315Probe"), cloud: CloudLibraryClient(baseURL: URL(string: "http://127.0.0.1:18735")!))
 var body: some Scene { WindowGroup { LibraryScreen(model: model).tint(.leafInk) } }
}
