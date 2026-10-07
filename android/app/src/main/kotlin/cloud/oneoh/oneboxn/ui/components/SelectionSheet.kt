package cloud.oneoh.oneboxn.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SheetState
import androidx.compose.material3.SheetValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.collapse
import androidx.compose.ui.semantics.dismiss
import androidx.compose.ui.semantics.expand
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import cloud.oneoh.oneboxn.ui.SecondaryTextSurface
import cloud.oneoh.oneboxn.ui.Theme
import cloud.oneoh.oneboxn.ui.tabular
import kotlin.math.abs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

// 选择弹层：从一组取值里选一个，选中即生效并收起。标题带条目数徽章，半屏 / 全屏两档皆可滚。
//
// 面板上没有卡片 ⇒ 取 `PlainPanel`（`surface`）。行直接用下拉面板的选项行：
// 选中底、对勾占位、次级文字随底升档都只有一个来源，几处不会各自漂。

/** 选择弹层里一行画什么；行本身（选中底、对勾、触感、命中高）由弹层统一画。 */
internal class SelectionRow(
    val title: String,
    val subtitle: String?,
    val state: MenuOptionState,
    /** 行尾槽；参数是这一行此刻坐着的底，理由见 [MenuOptionRow] 的 `trailing`。 */
    val trailing: @Composable (SecondaryTextSurface) -> Unit = {},
)

/**
 * [optionKey] 是惰性列表的 key：取值本身的稳定标识（节点 tag、配置 id）。
 * [onSelect] 当场生效，弹层随后播完收起动画再拆——顺序反过来会让触发器在动画期间还显示旧值。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun <T> SelectionSheet(
    title: String,
    options: List<T>,
    optionKey: (T) -> Any,
    optionRow: @Composable (T) -> SelectionRow,
    onSelect: (T) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState()
    val scope = rememberCoroutineScope()
    val stepTo = rememberSheetStepper(sheetState, onDismiss)
    val density = LocalDensity.current
    val threshold = with(density) { STEP_THRESHOLD.toPx() }
    val collapseOnTopOverscroll = remember(threshold, stepTo) {
        CollapseOnTopOverscroll(threshold) { stepTo(DragDirection.DOWN) }
    }
    // M3 按满高测量弹层内容，再把整块面板下移 offset 像素 ⇒ 半屏档下列表视口有 offset 那么长
    // 落在屏幕外，尾部内容永远滚不进可见区。补等量的底部内容内边距把尾部顶回来：
    // 滚到底时最后一行恰好停在可见区底边。展开档 offset≈0，自然无内边距。
    val hiddenBelowScreen by remember(sheetState, density) {
        derivedStateOf {
            // 必须钳位到非负：弹簧动画会让 offset 越过最小锚点变成负数，
            // 负数进 PaddingValues 直接抛 IllegalArgumentException。
            with(density) { sheetState.offsetOrZeroBeforeLayout().coerceAtLeast(0f).toDp() }
        }
    }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        // 弹层也是内容区：`ModalBottomSheet` 的 M3 默认上限 `640` 比内容区上限 `600` 宽，
        // 不给它，宽屏上弹层比页面还宽。
        sheetMaxWidth = Theme.maxReadableWidth,
        // 关掉弹层自带的嵌套滚动耦合与覆盖全弹层的拖动：二者与列表滚动共用一条手势通道，
        // 而 Compose 无法把进行中的手势移交给另一个 owner——到顶后必须抬手重按才滚、
        // 半屏档在屏幕外滚，都源于此。改档由横杆行独占，列表到顶下拉由过度滚动连接补回。
        sheetGesturesEnabled = false,
        shape = RoundedCornerShape(topStart = Theme.Radius.panel, topEnd = Theme.Radius.panel),
        containerColor = SheetPanel.PlainPanel.color(),
        dragHandle = { SheetGrabber(sheetState = sheetState, stepTo = stepTo) },
    ) {
        // 列表两档皆可滚：锁死半屏档只会让可见的几行无法翻阅，没有收益。
        LazyColumn(
            modifier = Modifier
                .nestedScroll(collapseOnTopOverscroll)
                .padding(horizontal = Theme.sheetInset),
            contentPadding = PaddingValues(bottom = hiddenBelowScreen + Theme.sheetBottomInset),
            verticalArrangement = Arrangement.spacedBy(OPTION_ROW_GAP),
        ) {
            // 标题行不给 key：节点 key 是服务端下发的 tag，任何字符串 key 都可能与某个 tag 撞上。
            item { SelectionSheetHeader(title = title, count = options.size) }
            items(items = options, key = optionKey) { option ->
                val row = optionRow(option)
                MenuOptionRow(
                    title = row.title,
                    subtitle = row.subtitle,
                    state = row.state,
                    entrance = OptionEntrance.Immediate,
                    trailing = row.trailing,
                    onClick = {
                        onSelect(option)
                        scope.hideThenDismiss(sheetState, onDismiss)
                    },
                )
            }
        }
    }
}

/** 标题 `16/600` 居中，与其余弹层标题一致；右侧是条目数徽章。 */
@Composable
private fun SelectionSheetHeader(title: String, count: Int) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Theme.Spacing.sm, Alignment.CenterHorizontally),
        // 纯文本行在弹层内衬之外再内缩一档，与块里的文字落在同一条读字边线上（内衬只约束带底色的块）。
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = Theme.Spacing.textInset)
            .padding(top = Theme.Spacing.lg, bottom = Theme.Spacing.md),
    ) {
        Text(
            text = title,
            style = Theme.Type.sheetTitle,
            color = Theme.colors.textPrimary,
        )
        Text(
            text = count.toString(),
            style = Theme.Type.badge.tabular(),
            color = Theme.colors.textSecondary,
            modifier = Modifier
                .background(Theme.colors.fill, Theme.Radius.pill)
                .padding(horizontal = Theme.Spacing.sm, vertical = Theme.Spacing.xs),
        )
    }
}

/**
 * `requireOffset` 在首次布局前（锚点尚未建立）必抛：那一刻弹层还没上屏，落在屏幕外的部分就是 0。
 * 只接这一种异常，别的异常说明状态真坏了，照常崩。
 */
@OptIn(ExperimentalMaterial3Api::class)
private fun SheetState.offsetOrZeroBeforeLayout(): Float = try {
    requireOffset()
} catch (notLaidOut: IllegalStateException) {
    0f
}

// 收起统一走「先播完动画、再拆掉弹层」；直接置位可见标志会让弹层瞬移消失。
@OptIn(ExperimentalMaterial3Api::class)
private fun CoroutineScope.hideThenDismiss(sheetState: SheetState, onDismiss: () -> Unit) {
    launch { sheetState.hide() }.invokeOnCompletion { onDismiss() }
}

// 分档阈值（横杆行拖动与列表到顶下拉共用）：累计位移越过它即切档，弹簧动画接管。不做 1:1 跟手——
// SheetState 的锚定拖动状态是 material3 internal，应用侧取不到偏移量。
private val STEP_THRESHOLD = 24.dp

/** 一次改档操作朝哪个方向。 */
internal enum class DragDirection { UP, DOWN }

/**
 * 弹层此刻停在（或正驶向）哪一档，连同「有没有半屏档」一起。
 * 两件事并成一个枚举：「停在半屏而没有半屏档」这种不存在的组合就表达不出来。
 */
internal enum class SheetPosition {
    /** 半屏档；正在收起也按这一档裁决（上拖拉回、下拖继续收起）。 */
    PARTIAL,

    /** 全屏档，下面还有半屏档。 */
    EXPANDED_ABOVE_PARTIAL,

    /** 全屏档且没有半屏档：内容不足半屏时 M3 不产生半屏锚点，弹层直接落在这里。 */
    EXPANDED_ONLY,
}

/** 横杆行一次操作的目标档位。 */
internal enum class SheetStep { EXPAND, PARTIAL_EXPAND, HIDE, NONE }

/** 分档裁决：无半屏档时向下即收起，故短列表一步关闭。纯逻辑，与 Compose 无关，单测锁定。 */
internal fun sheetStepFor(position: SheetPosition, direction: DragDirection): SheetStep = when (direction) {
    DragDirection.UP -> if (position == SheetPosition.PARTIAL) SheetStep.EXPAND else SheetStep.NONE
    DragDirection.DOWN ->
        if (position == SheetPosition.EXPANDED_ABOVE_PARTIAL) SheetStep.PARTIAL_EXPAND else SheetStep.HIDE
}

// 读 targetValue 而非 currentValue：档位动画期间 currentValue 还停在起点，此时反向再拖一次会按起点裁决——
// 上拖到一半改主意往回拖，就会从「回半屏」错判成「收起」。
@OptIn(ExperimentalMaterial3Api::class)
private fun SheetState.position(): SheetPosition = when {
    targetValue != SheetValue.Expanded -> SheetPosition.PARTIAL
    hasPartiallyExpandedState -> SheetPosition.EXPANDED_ABOVE_PARTIAL
    else -> SheetPosition.EXPANDED_ONLY
}

// 分档执行器：把「往哪个方向走一步」翻译成对 sheetState 的调用。横杆行与列表过度滚动
// 共用同一份，两条入口的档位语义因此不可能分叉。
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun rememberSheetStepper(
    sheetState: SheetState,
    onDismiss: () -> Unit,
): (DragDirection) -> Unit {
    val scope = rememberCoroutineScope()
    return remember(sheetState, onDismiss, scope) {
        { direction: DragDirection ->
            when (sheetStepFor(sheetState.position(), direction)) {
                SheetStep.EXPAND -> scope.launch { sheetState.expand() }
                SheetStep.PARTIAL_EXPAND -> scope.launch { sheetState.partialExpand() }
                SheetStep.HIDE -> scope.hideThenDismiss(sheetState, onDismiss)
                SheetStep.NONE -> Unit
            }
        }
    }
}

/**
 * 列表滚到顶后继续下拉即退一档——Android 弹层的通用手感，`sheetGesturesEnabled = false`
 * 会一并关掉它，故在此精确补回。
 *
 * **只用 `onPostScroll` 的剩余增量、且只认向下**：M3 自带的连接用 `onPreScroll` 抢走上滑增量，
 * 列表还没滚弹层先被顶走；本连接不碰那条路径，因而不会把它带回来。
 * 列表只要还能滚（`consumed.y != 0`）就清零累计——那说明还没到顶，不算过度滚动。
 */
private class CollapseOnTopOverscroll(
    private val threshold: Float,
    private val onStepDown: () -> Unit,
) : NestedScrollConnection {
    private var travel = 0f
    private var stepped = false

    override fun onPostScroll(
        consumed: Offset,
        available: Offset,
        source: NestedScrollSource,
    ): Offset {
        if (source != NestedScrollSource.UserInput || consumed.y != 0f || available.y <= 0f) {
            travel = 0f
            return Offset.Zero
        }
        if (!stepped) {
            travel += available.y
            if (travel >= threshold) {
                stepped = true
                onStepDown()
            }
        }
        // 不消费：过度滚动的视觉反馈仍归列表，本连接只旁听。
        return Offset.Zero
    }

    // 手势结束即复位，使「一次手势只走一档」与横杆行同规则。
    override suspend fun onPreFling(available: Velocity): Velocity {
        travel = 0f
        stepped = false
        return Velocity.Zero
    }
}

// 顶部横杆所在整行：改档的唯一入口，整行可拖可点（命中面比横杆本身大得多）。
// 关掉 sheetGesturesEnabled 会连带摘掉 M3 挂在横杆上的无障碍动作，此处自行补回。
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SheetGrabber(sheetState: SheetState, stepTo: (DragDirection) -> Unit) {
    val threshold = with(LocalDensity.current) { STEP_THRESHOLD.toPx() }
    var travel by remember { mutableFloatStateOf(0f) }
    // 一次手势只走一档。越阈值后若只清零累计量、任由本次手势继续攒，长拖会连续触发：
    // 展开档一次长下拖就会「展开→半屏→收起」一步到底，跳掉半屏档。
    var stepped by remember { mutableStateOf(false) }

    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .fillMaxWidth()
            .draggable(
                state = rememberDraggableState { delta ->
                    if (!stepped) {
                        travel += delta
                        if (abs(travel) >= threshold) {
                            stepTo(if (travel < 0f) DragDirection.UP else DragDirection.DOWN)
                            stepped = true
                        }
                    }
                },
                orientation = Orientation.Vertical,
                onDragStarted = {
                    travel = 0f
                    stepped = false
                },
                onDragStopped = { travel = 0f },
            )
            // 点按等价于「往当前档位的反方向走一步」：半屏 ↔ 展开档。
            .clickable {
                stepTo(if (sheetState.targetValue == SheetValue.Expanded) DragDirection.DOWN else DragDirection.UP)
            }
            .semantics(mergeDescendants = true) {
                dismiss {
                    stepTo(DragDirection.DOWN)
                    true
                }
                if (sheetState.currentValue == SheetValue.PartiallyExpanded) {
                    expand {
                        stepTo(DragDirection.UP)
                        true
                    }
                } else if (sheetState.hasPartiallyExpandedState) {
                    collapse {
                        stepTo(DragDirection.DOWN)
                        true
                    }
                }
            },
    ) {
        BottomSheetDefaults.DragHandle()
    }
}
