package cloud.oneoh.oneboxn.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.ui.Theme
import cloud.oneoh.oneboxn.app
import cloud.oneoh.oneboxn.core.RefreshRecord
import cloud.oneoh.oneboxn.core.RefreshRecordOutcome
import cloud.oneoh.oneboxn.ui.components.SheetPanel
import cloud.oneoh.oneboxn.ui.components.color
import cloud.oneoh.oneboxn.ui.components.EmptyState
import cloud.oneoh.oneboxn.ui.components.preferenceRowPadding
import com.microsoft.fluent.mobile.icons.R as FluentR
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.graphics.Color

// 更新记录页：单一时间线倒序，
// 点行弹任务详情。**枚举 token 原样英文呈现、不进 i18n**——它们是诊断词表，
// 翻译只会让页面与日志对不上。
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RefreshRecordsScreen(onBack: () -> Unit) {
    val vm: RefreshRecordsViewModel = viewModel { RefreshRecordsViewModel(app.actions) }

    Scaffold(
        modifier = Modifier.screenBackground(),
        containerColor = Color.Transparent,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.dev_records_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            painter = painterResource(FluentR.drawable.ic_fluent_chevron_left_24_regular),
                            contentDescription = stringResource(R.string.back),
                        )
                    }
                },
                colors = pageTopBarColors(),
            )
        },
    ) { padding ->
        if (vm.timeline.isEmpty()) {
            EmptyState(
                // 回拨时钟，与开发者页「更新记录」入口同一颗（`text_align_left` 是「日志」那一颗，
                // 同一个符号不表达两件事）。
                icon = painterResource(FluentR.drawable.ic_fluent_history_24_regular),
                title = stringResource(R.string.dev_records_empty),
                caption = stringResource(R.string.dev_records_empty_caption),
                // 水平边距 = 本页页边距（同列表那份 `contentPadding` 的左右值）。
                modifier = Modifier.fillMaxSize().padding(padding)
                    .readableContentWidth()
                    .padding(horizontal = Theme.Spacing.lg),
            )
        } else {
            // 全部行同处一张 `surface` 卡，**行间不画分隔线**。
            // 行靠 52 的行高与按下时的整行填充分开，不靠线。
            LazyColumn(
                // 宽屏上把列表收到 `Theme.maxReadableWidth` 并居中。
                // 代价：收的是列表**自己的宽**，于是宽屏上两侧留白里滑不动 ——
                // 与走 `verticalScroll` 的那几屏不同（那边滚动留在外层、整面可滑）。
                // `LazyColumn` 要保住「整面可滑」就得按可用宽算 `contentPadding`，
                // 那要给每个列表套一层 `BoxWithConstraints`；两种做法的屏上结果相同，差别只在手势面。
                modifier = Modifier.fillMaxSize().padding(padding).readableContentWidth(),
                contentPadding = PaddingValues(
                    start = Theme.Spacing.lg,
                    end = Theme.Spacing.lg,
                    bottom = Theme.Spacing.md,
                ),
            ) {
                item {
                    Column(Modifier.fillMaxWidth().cardSurface().padding(vertical = Theme.Spacing.xs)) {
                        for (record in vm.timeline) {
                            RecordRow(record, onClick = { vm.openDetail(record) })
                        }
                    }
                }
            }
        }
    }

    vm.detail?.let { record ->
        ModalBottomSheet(
            // 弹层也是内容区：`ModalBottomSheet` 的 M3 默认上限 `640` 比内容区上限 `600` 宽，
            // 不给它，宽屏上弹层比页面还宽。
            sheetMaxWidth = Theme.maxReadableWidth,
            onDismissRequest = vm::dismissDetail,
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = SheetPanel.PlainPanel.color(),
        ) {
            RecordDetail(record)
        }
    }
}

@Composable
private fun RecordRow(record: RefreshRecord, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .preferenceRowPadding(),
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                text = record.profileName.ifEmpty { record.profileId.ifEmpty { "—" } },
                style = Theme.Type.rowTitle,
                color = Theme.colors.textPrimary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = timestampLabel(record.occurredAtMillis),
                style = Theme.Type.meta,
                fontFamily = FontFamily.Monospace,
                color = Theme.colors.textSecondary,
            )
        }
        Spacer(Modifier.padding(horizontal = 4.dp))
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            // 结局与抓取方式都取 `11` 等宽，与左栏时刻同级：本行副信息同级，否则右栏自己就不齐。
            Text(
                text = record.outcome.name,
                style = Theme.Type.meta,
                fontFamily = FontFamily.Monospace,
                color = outcomeColor(record.outcome),
            )
            Text(
                text = record.route.name,
                style = Theme.Type.meta,
                fontFamily = FontFamily.Monospace,
                color = Theme.colors.textSecondary,
            )
        }
    }
}

@Composable
private fun RecordDetail(record: RefreshRecord) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = Theme.Spacing.lg)
            .padding(bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = stringResource(R.string.dev_record_detail_title),
            style = Theme.Type.sheetTitle,
        )
        // 空字段整行省略，不展示占位。
        for ((label, value) in detailFields(record)) {
            if (value.isEmpty()) continue
            Row(modifier = Modifier.fillMaxWidth()) {
                Text(
                    text = label,
                    style = Theme.Type.control,
                    color = Theme.colors.textSecondary,
                )
                Spacer(Modifier.weight(1f))
                Text(
                    text = value,
                    style = Theme.Type.control,
                    fontFamily = FontFamily.Monospace,
                )
            }
        }
    }
}

// 字段名与 RefreshRecord 的字段一一对应，英文原样——与记录里的 token 同一方言。
private fun detailFields(record: RefreshRecord): List<Pair<String, String>> = listOf(
    "time" to timestampLabel(record.occurredAtMillis),
    "profile" to record.profileName,
    "profileId" to record.profileId,
    "trigger" to record.trigger.name,
    "outcome" to record.outcome.name,
    "contentChanged" to record.contentChanged.toString(),
    "duration" to "${record.durationMillis} ms",
    "route" to record.route.name,
    "denial" to (record.denial?.name ?: ""),
    "error" to record.errorToken,
    "used" to record.usedTraffic.toString(),
    "total" to record.totalTraffic.toString(),
    "expire" to if (record.expireTime > 0) expiryDateLabel(record.expireTime) else "",
)

// 与 Formats.kt 同款：构造调用写在一行并显式传 Locale.US（make check rule=locale）。
private fun timestampLabel(millis: Long): String =
    SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date(millis))

// 三态取**状态语义色**，不取 accent：accent 是品牌 / 动作色、不带褒贬，拿它当成功色，
// 三态读成「蓝 / 灰 / 红」，而蓝说的是「可操作」不是「成功了」。
@Composable
private fun outcomeColor(outcome: RefreshRecordOutcome) = when (outcome) {
    RefreshRecordOutcome.UPDATED -> Theme.tones.success.fg
    RefreshRecordOutcome.DROPPED -> Theme.colors.textSecondary
    RefreshRecordOutcome.FAILED -> Theme.tones.error.fg
}
