import Foundation
import LeafhourCore
@main struct LiveSmoke {
 static func main() async {
  do {
   let process = Process(), pipe = Pipe()
   process.executableURL = URL(fileURLWithPath: "/usr/bin/security")
   process.arguments = ["find-generic-password", "-s", "com.cubxxw.agents.default-data-workspace", "-a", "test@cubxxw.com", "-w"]
   process.standardOutput = pipe; process.standardError = FileHandle.nullDevice
   try process.run()
   let bytes = pipe.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
   guard process.terminationStatus == 0, let value = String(data: bytes, encoding: .utf8) else { throw LibraryError.invalid("Keychain unavailable") }
   let client = CloudLibraryClient()
   let account = try await client.signIn(email: "test@cubxxw.com", password: value.trimmingCharacters(in: .newlines))
   guard account.email == "test@cubxxw.com" else { throw LibraryError.invalid("Unexpected account") }
   let shelf = try await client.shelf(ownerID: account.id)
   guard let book = shelf.first else { throw LibraryError.invalid("No account books") }
   let copy = try await client.downloadReadingCopy(book, ownerID: account.id)
   let records = try CloudJSON.decode(await client.data(path: "/api/library/books/" + CloudJSON.component(book.id) + "/records", ownerID: account.id))
   let output: [String: Any] = ["status":"passed", "accountMatches":true, "shelfBooks":shelf.count, "downloadedChapters":copy.chapters.count, "downloadedPassages":copy.chapters.reduce(0) { $0 + $1.passages.count }, "sourceIDsPreserved":copy.identity.bookID == book.id, "recordsVersionMatches":records["contentVersion"].string == copy.identity.contentVersion, "writesPerformed":false]
   print(String(data: try JSONSerialization.data(withJSONObject: output, options: .sortedKeys), encoding: .utf8)!)
  } catch { print("{\"status\":\"failed\",\"errorType\":\"" + String(describing: type(of: error)) + "\"}"); exit(1) }
 }
}
