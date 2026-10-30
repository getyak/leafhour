import SwiftUI
import UIKit
import LeafhourCore

/// Both text views retain their identity through window changes. Only the
/// primary language owns progress; the optional source column follows its
/// semantic passage anchor rather than a scroll percentage.
struct ReaderContentView: View {
    let session: ReaderSession
    var pageInsets = UIEdgeInsets(top:24,left:24,bottom:64,right:24)
    var selectionDismissalID = UUID()
    let onNote:(SelectedQuote)->Void
    let onSource:(SelectedQuote)->Void
    var onExplain:((SelectedQuote)->Void)? = nil
    let onWake:(ReaderChrome)->Void
    let onReadingScroll:()->Void
    var onTranslate:((SelectedQuote)->Void)? = nil
    var onSelectionChange:((SelectedQuote?,Bool)->Void)? = nil
    var onPageChange:((ReaderPagePosition)->Void)? = nil
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo:.body) private var minimumColumnWidth = 320.0
    var body:some View {
        GeometryReader { geometry in
            let _ = session.translationRevision
            let paired = session.state.preferences.textMode == .parallel
                && !typeSize.isAccessibilitySize && geometry.size.width >= minimumColumnWidth * 2 + 24
            ZStack(alignment:.leading) {
                TextReadingView(session:session,pageInsets:pageInsets,selectionDismissalID:selectionDismissalID,
                    onNote:onNote,onSource:onSource,onExplain:onExplain,onWake:onWake,onReadingScroll:onReadingScroll,
                    onTranslate:onTranslate,onSelectionChange:onSelectionChange,onPageChange:onPageChange,
                    modeOverride:paired ? .translation : nil)
                    .frame(width:paired ? geometry.size.width/2 : geometry.size.width)
                    .frame(maxWidth:.infinity,alignment:.trailing)
                TextReadingView(session:session,pageInsets:pageInsets,selectionDismissalID:selectionDismissalID,
                    onNote:onNote,onSource:onSource,onExplain:onExplain,onWake:onWake,onReadingScroll:{},onTranslate:onTranslate,
                    onSelectionChange:onSelectionChange,modeOverride:.original,ownsProgress:false,synchronizedAnchor:session.currentAnchor)
                    .frame(width:paired ? geometry.size.width/2 : geometry.size.width)
                    .clipped().opacity(paired ? 1 : 0).allowsHitTesting(paired).accessibilityHidden(!paired)
            }
        }
    }
}

private struct ReaderAutomaticTranslationKey: EnvironmentKey {
    static let defaultValue: ReaderAutomaticTranslation? = nil
}
extension EnvironmentValues {
    var readerAutomaticTranslation:ReaderAutomaticTranslation? {
        get { self[ReaderAutomaticTranslationKey.self] }
        set { self[ReaderAutomaticTranslationKey.self] = newValue }
    }
}

struct ReaderAutomaticTranslationStatus: View {
    let session:ReaderSession
    @Environment(\.readerAutomaticTranslation) private var pipeline
    var body:some View {
        if session.book.cloud == nil {
            Text("这是此设备上的原文。登录并同步到自己的书房后，可自动准备译文。")
                .font(.footnote).foregroundStyle(.secondary)
        } else if let pipeline {
            if let error = pipeline.error {
                Text(error).font(.footnote).foregroundStyle(.secondary)
                Button("重试自动准备",systemImage:"arrow.clockwise") { pipeline.retry() }
                    .frame(minHeight:44).accessibilityIdentifier("reader-translation-retry")
            } else if pipeline.loading {
                HStack { ProgressView(); Text(pipeline.preparingNext ? "正在提前准备下一章" : "正在准备当前章译文") }
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
}
