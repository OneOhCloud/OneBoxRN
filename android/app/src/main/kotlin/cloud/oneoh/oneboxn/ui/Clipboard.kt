package cloud.oneoh.oneboxn.ui

import android.content.ClipData
import androidx.compose.ui.platform.Clipboard
import androidx.compose.ui.platform.ClipEntry

// 剪贴板**写入**的唯一出处（镜像 iOS App/UI/Clipboard.swift 的契约）：
// `ClipData` 的构造样板在设置页 UA、配置页正文、启动失败详情、日志行四处重复出现。
//
// **返回是否无可检测的失败**（不是「确证已写入」），与 iOS 侧同契约。调用方据此决定是否
// 给「已复制」反馈——忽略它就会在写失败时报成功，属吞错。这里捕获平台异常不是防御性
// 吞错：剪贴板被系统或其他应用拒绝是**环境条件**而非非法状态，Apple 侧同样以返回值而非崩溃表达
// （`NSPasteboard.setString` 返回 false）；两端若一端返回布尔、一端抛异常，同一用户操作就会有
// 两种结局。
//
// **检测不到的失败**：系统在 `WRITE_CLIPBOARD` AppOp 被拒时直接返回、不抛异常，此路径无从察觉。
// 不读回校验：Android 12+ 读剪贴板会弹系统 toast、且 10+ 仅焦点应用可读，每复制一次弹一次的代价
// 大于它能发现的故障。这一残余缺口两端同形（iOS 的 `UIPasteboard` 赋值同样无返回值）。
//
// label 只用于系统 UI 的来源提示，与写入内容无关，故由调用方按语义给出。
suspend fun Clipboard.writeText(label: String, text: String): Boolean =
    runCatching { setClipEntry(ClipEntry(ClipData.newPlainText(label, text))) }.isSuccess

/** 「已复制」回执的驻留时长：设置页 UA、配置页正文、配置详情的两行复制同一档。 */
internal const val COPY_FEEDBACK_MS = 2_000L
