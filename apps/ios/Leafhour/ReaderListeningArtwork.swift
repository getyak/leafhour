import UIKit
import LeafhourCore

/// A deterministic, local lock-screen cover. Real covers keep their complete
/// image; missing covers use only the supplied bibliographic metadata.
@MainActor enum ReaderListeningArtwork {
    static func render(title: String, author: String?, cover: UIImage?, preferences: ReaderPreferences,
                       traits: UITraitCollection = UITraitCollection(userInterfaceStyle: .light)) -> UIImage {
        let size = CGSize(width: 1024, height: 1024)
        let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true; format.preferredRange = .standard
        let paper = preferences.paperColor.resolvedColor(with: traits)
        let paperStyle = ReaderPaper(rawValue: preferences.theme) ?? .system
        let dark = paperStyle.isDark || (paperStyle == .system && traits.userInterfaceStyle == .dark)
        let ink = dark ? UIColor(white: 0.92, alpha: 1) : UIColor(white: 0.16, alpha: 1)
        let secondary = dark ? UIColor(white: 0.68, alpha: 1) : UIColor(white: 0.39, alpha: 1)
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            paper.setFill(); context.fill(CGRect(origin: .zero, size: size))
            if let cover, cover.size.width > 0, cover.size.height > 0, cover.size.width.isFinite, cover.size.height.isFinite {
                let available = CGRect(x: 64, y: 64, width: 896, height: 896)
                let scale = min(available.width / cover.size.width, available.height / cover.size.height)
                let fitted = CGSize(width: cover.size.width * scale, height: cover.size.height * scale)
                cover.draw(in: CGRect(x: available.midX - fitted.width / 2, y: available.midY - fitted.height / 2,
                                      width: fitted.width, height: fitted.height))
                return
            }
            let titleArea = CGRect(x: 96, y: 144, width: 832, height: 568)
            let titleText = title as NSString
            let font = fittingFont(titleText, in: titleArea.size, preferences: preferences, traits: traits)
            let paragraph = NSMutableParagraphStyle(); paragraph.lineBreakMode = .byWordWrapping
            paragraph.lineSpacing = font.pointSize * 0.12
            let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: ink, .paragraphStyle: paragraph]
            let measured = titleText.boundingRect(with: titleArea.size, options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: attributes, context: nil)
            titleText.draw(with: CGRect(x: titleArea.minX, y: titleArea.midY - ceil(measured.height) / 2,
                                        width: titleArea.width, height: ceil(measured.height) + 2),
                           options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: attributes, context: nil)
            if let author, !author.isEmpty {
                let authorArea = CGRect(x: 96, y: 768, width: 832, height: 88)
                let authorFont = fittingFont(author as NSString, in: authorArea.size, preferences: preferences, traits: traits, maximum: 36)
                (author as NSString).draw(with: authorArea, options: [.usesLineFragmentOrigin, .usesFontLeading],
                    attributes: [.font: authorFont, .foregroundColor: secondary], context: nil)
            }
            ("Leafhour" as NSString).draw(at: CGPoint(x: 96, y: 912), withAttributes: [
                .font: UIFont.systemFont(ofSize: 25, weight: .medium), .foregroundColor: secondary,
                .kern: 1.5
            ])
        }
    }

    private static func fittingFont(_ text: NSString, in size: CGSize, preferences: ReaderPreferences,
                                    traits: UITraitCollection, maximum: Double = 88) -> UIFont {
        // A fixed artwork canvas uses the selected local families with a stable
        // type category, independent of the system's lock-screen display scale.
        let typographyTraits = UITraitCollection(traitsFrom: [traits, UITraitCollection(preferredContentSizeCategory: .large)])
        var pointSize = maximum
        while pointSize > 8 {
            let font = ReaderTypography.font(style: preferences.fontStyle, size: pointSize, traits: typographyTraits, latin: preferences.latinFont)
            let paragraph = NSMutableParagraphStyle(); paragraph.lineBreakMode = .byWordWrapping; paragraph.lineSpacing = font.pointSize * 0.12
            let bounds = text.boundingRect(with: CGSize(width: size.width, height: .greatestFiniteMagnitude),
                options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: font, .paragraphStyle: paragraph], context: nil)
            if ceil(bounds.height) <= size.height && ceil(bounds.width) <= size.width { return font }
            pointSize -= 2
        }
        return ReaderTypography.font(style: preferences.fontStyle, size: pointSize, traits: typographyTraits, latin: preferences.latinFont)
    }
}
