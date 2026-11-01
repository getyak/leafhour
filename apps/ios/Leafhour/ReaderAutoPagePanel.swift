import SwiftUI
import LeafhourCore

extension ReaderAutoPagePauseReason {
    var readerDescription: String {
        switch self {
        case .user: "已手动暂停"
        case .inactive: "离开书页后已暂停"
        case .interaction: "操作书页后已暂停"
        case .selection: "选字时已暂停"
        case .panel: "打开工具后已暂停"
        case .listening: "听书时已暂停"
        case .voiceOver: "VoiceOver 开启时已暂停"
        case .navigation: "阅读位置或翻页方式改变后已暂停"
        case .layout: "页面尚未准备好，已暂停"
        }
    }
}

struct ReaderAutoPagePanel: View {
    @Bindable var controller: ReaderAutoPageController
    @Binding var interval: Double
    let navigationMode: ReaderNavigationMode
    let onStart: () -> Void

    private var intervalBinding: Binding<Double> {
        Binding(get: { ReaderAutoPageState.normalizedInterval(interval) }, set: { value in
            interval = ReaderAutoPageState.normalizedInterval(value)
            controller.setInterval(interval)
        })
    }
    private var isRunning: Bool { controller.state.phase == .running }
    private var startTitle: String {
        switch controller.state.phase {
        case .paused: "继续自动翻页"
        default: navigationMode == .paged ? "开始自动翻页" : "切换左右翻页并开始"
        }
    }

    var body: some View {
        Form {
            Section {
                Label {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(statusTitle).font(.headline)
                        Text(statusDetail).font(.subheadline).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                } icon: { Image(systemName: isRunning ? "play.circle" : "pause.circle").foregroundStyle(Color.leafInk) }
            }
            Section("翻页间隔") {
                Stepper(value: intervalBinding, in: 5...120, step: 5) {
                    Text("每 \(Int(intervalBinding.wrappedValue)) 秒翻一屏")
                        .monospacedDigit().fixedSize(horizontal: false, vertical: true)
                }.frame(minHeight: 44).accessibilityIdentifier("reader-auto-page-interval")
            }
            Section {
                if isRunning {
                    Button("暂停自动翻页", systemImage: "pause.fill") { controller.pause() }
                        .frame(minHeight: 44).accessibilityIdentifier("reader-auto-page-pause")
                } else {
                    Button(startTitle, systemImage: "play.fill", action: onStart)
                        .frame(minHeight: 44).disabled(controller.conditions.voiceOverEnabled)
                        .accessibilityIdentifier("reader-auto-page-start")
                }
                if controller.isActive {
                    Button("结束自动翻页", systemImage: "stop.fill") { controller.stop() }
                        .frame(minHeight: 44).accessibilityIdentifier("reader-auto-page-stop")
                }
            } footer: {
                Text("触碰书页、选字、打开工具或开始听书都会暂停；需要时再点继续。离开 App 后不会自行恢复。")
            }
        }
        .navigationTitle("自动翻页")
        .onAppear { controller.setInterval(interval) }
    }

    private var statusTitle: String {
        switch controller.state.phase {
        case .stopped: "按自己的节奏阅读"
        case .running: "正在自动翻页"
        case .paused: "自动翻页已暂停"
        case .finished: "已到本书结尾"
        }
    }
    private var statusDetail: String {
        if controller.conditions.voiceOverEnabled { return "使用 VoiceOver 时请手动翻页，避免打断朗读焦点。" }
        switch controller.state.phase {
        case .stopped: return "开始后按间隔翻到下一屏，也可以随时暂停。"
        case .running: return "每 \(Int(controller.state.interval)) 秒翻一屏。"
        case .paused(let reason): return reason.readerDescription + "。点继续后重新计时。"
        case .finished: return "自动翻页已结束，阅读位置已保留。"
        }
    }
}

/// The stop/pause route stays visible while ordinary reader chrome is asleep.
/// No ticking number or animation competes with the text.
struct ReaderAutoPageStatusControl: View {
    @Bindable var controller: ReaderAutoPageController
    let onContinue: () -> Void
    let onSettings: () -> Void
    @State private var showingOptions = false

    var body: some View {
        if controller.showsStatus {
            HStack(spacing: 4) {
                Button(action: onSettings) {
                    Text(statusTitle).font(.subheadline)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                }.buttonStyle(.plain).accessibilityValue(detail)
                    .accessibilityIdentifier("reader-auto-page-status")
                if controller.state.phase == .running {
                    Button("暂停自动翻页", systemImage: "pause.fill") { controller.pause() }
                        .labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44)
                        .accessibilityIdentifier("reader-auto-page-quick-pause")
                } else if controller.state.phase == .finished {
                    Button("关闭自动翻页状态", systemImage: "xmark") { controller.stop() }
                        .labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44)
                } else {
                    Button("继续自动翻页", systemImage: "play.fill", action: onContinue)
                        .labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44)
                        .disabled(controller.conditions.pauseReason != nil)
                        .accessibilityIdentifier("reader-auto-page-quick-resume")
                }
                Button {
                    controller.pause(.panel)
                    showingOptions = true
                } label: {
                    Label("自动翻页选项", systemImage: "ellipsis").labelStyle(.iconOnly)
                        .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                }.accessibilityIdentifier("reader-auto-page-options")
            }
            .padding(.horizontal, 12)
            .background(.regularMaterial, in: Capsule())
            .accessibilityElement(children: .contain)
            .confirmationDialog("自动翻页", isPresented: $showingOptions, titleVisibility: .visible) {
                Button("调整间隔", action: onSettings)
                Button("结束自动翻页") { controller.stop() }
                Button("取消", role: .cancel) { }
            }
        }
    }
    private var detail: String {
        switch controller.state.phase {
        case .running: "每 \(Int(controller.state.interval)) 秒一屏"
        case .paused(let reason): reason.readerDescription
        case .finished: "已到本书结尾"
        default: ""
        }
    }
    private var statusTitle: String {
        switch controller.state.phase {
        case .running: "自动 · \(Int(controller.state.interval))秒"
        case .finished: "自动翻页已结束"
        default: "自动翻页已暂停"
        }
    }
}
