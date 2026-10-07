package cloud.oneoh.oneboxn.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.LocalActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.ImageAnalysis
import androidx.camera.mlkit.vision.MlKitAnalyzer
import androidx.camera.view.LifecycleCameraController
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import cloud.oneoh.oneboxn.R
import cloud.oneoh.oneboxn.ui.Theme
import cloud.oneoh.oneboxn.core.ImportPayload
import cloud.oneoh.oneboxn.ui.components.PrimaryButton
import cloud.oneoh.oneboxn.ui.components.StatusOrb
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import androidx.compose.ui.graphics.Color
import com.microsoft.fluent.mobile.icons.R as FluentR

// 扫码页：权限四态由系统权限 API 驱动，
// 已授权态起 CameraX 取景 + QR 识别；识别文本经 ScanViewModel 交唯一解析器判定。
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScanScreen(
    onRecognized: (ImportPayload) -> Unit,
    onBack: () -> Unit,
) {
    val vm: ScanViewModel = viewModel()
    val context = LocalContext.current
    val activity = checkNotNull(LocalActivity.current) { "ScanScreen requires an Activity host" }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        // 拒绝时以「还会再显示 rationale」判定可否再询问：false 即系统不再弹框 → 出路只剩设置页。
        vm.updatePermission(
            granted = granted,
            canAskAgain = activity.shouldShowRequestPermissionRationale(Manifest.permission.CAMERA),
        )
    }

    // 挂载即检查并请求：已授权直接起相机，未授权立刻弹系统权限框。
    LaunchedEffect(Unit) {
        if (hasCameraPermission(context)) {
            vm.updatePermission(granted = true, canAskAgain = false)
        } else {
            permissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }
    // 返回前台重查（从系统设置授权归来）：仅向上收敛到已授权，不在此发起请求——
    // 系统权限框本身会走一次 pause/resume，若在此重发请求会形成弹框死循环。
    LifecycleResumeEffect(Unit) {
        if (hasCameraPermission(context)) vm.updatePermission(granted = true, canAskAgain = false)
        onPauseOrDispose {}
    }

    Scaffold(
        modifier = Modifier.screenBackground(),
        containerColor = Color.Transparent,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.scan_title)) },
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
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .readableContentWidth()
                .padding(horizontal = Theme.Spacing.lg),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp, Alignment.CenterVertically),
        ) {
            when (vm.permission) {
                ScanViewModel.Permission.CHECKING -> {
                    CircularProgressIndicator(modifier = Modifier.size(48.dp))
                    Text(
                        text = stringResource(R.string.scan_checking),
                        style = Theme.Type.emptyTitle,
                    )
                }
                ScanViewModel.Permission.ASKABLE -> {
                    StatusOrb(
                        icon = painterResource(FluentR.drawable.ic_fluent_camera_24_regular),
                        tint = Theme.colors.accent,
                        container = Theme.colors.accentContainer,
                    )
                    Text(
                        text = stringResource(R.string.scan_askable),
                        style = Theme.Type.emptyTitle,
                        textAlign = TextAlign.Center,
                    )
                    PrimaryButton(
                        label = stringResource(R.string.scan_request),
                        onClick = { permissionLauncher.launch(Manifest.permission.CAMERA) },
                    )
                }
                ScanViewModel.Permission.DENIED -> {
                    StatusOrb(
                        icon = painterResource(FluentR.drawable.ic_fluent_camera_24_regular),
                        tint = Theme.tones.error.fg,
                        container = Theme.tones.error.container,
                    )
                    Text(
                        text = stringResource(R.string.scan_denied),
                        style = Theme.Type.emptyTitle,
                    )
                    PrimaryButton(
                        label = stringResource(R.string.scan_open_settings),
                        onClick = {
                            context.startActivity(
                                Intent(
                                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                    Uri.fromParts("package", context.packageName, null),
                                ),
                            )
                        },
                    )
                }
                ScanViewModel.Permission.GRANTED -> {
                    CameraViewfinder(
                        onRearmed = vm::rearm,
                        onQrText = { raw -> vm.onQrRecognized(raw)?.let(onRecognized) },
                    )
                    Text(
                        text = stringResource(R.string.scan_hint),
                        style = Theme.Type.status,
                        color = Theme.colors.textSecondary,
                    )
                }
            }
        }
    }

    if (vm.showRejected) {
        AlertDialog(
            onDismissRequest = vm::confirmRejected,
            title = { Text(stringResource(R.string.scan_failed)) },
            text = { Text(stringResource(R.string.scan_failed_caption)) },
            confirmButton = {
                TextButton(onClick = vm::confirmRejected) {
                    Text(stringResource(R.string.ok))
                }
            },
        )
    }
}

private fun hasCameraPermission(context: Context): Boolean =
    context.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

// 取景框（240×240、Radius.panel）：LifecycleCameraController 驱动 PreviewView，
// 识别分析器仅认 QR 格式；进入本组件即重新武装闩锁，相机与识别器随组件离屏释放。
@Composable
private fun CameraViewfinder(onRearmed: () -> Unit, onQrText: (String) -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val controller = remember { LifecycleCameraController(context) }

    AndroidView(
        factory = { viewContext -> PreviewView(viewContext).apply { this.controller = controller } },
        modifier = Modifier
            .size(240.dp)
            .clip(RoundedCornerShape(Theme.Radius.panel)),
    )

    DisposableEffect(Unit) {
        // 仅 QR 一种格式：缩小识别面既符合本页语义也降低逐帧算力。
        val scanner = BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build(),
        )
        val mainExecutor = ContextCompat.getMainExecutor(context)
        controller.setImageAnalysisAnalyzer(
            mainExecutor,
            MlKitAnalyzer(listOf(scanner), ImageAnalysis.COORDINATE_SYSTEM_ORIGINAL, mainExecutor) { result ->
                // 多数帧无条码 → 静默跳过；识别出条码但无文本载荷（二进制 QR）→ 空串交解析器，与乱文同拒（NOT_LINK）。
                val barcode = result.getValue(scanner)?.firstOrNull() ?: return@MlKitAnalyzer
                onQrText(barcode.rawValue.orEmpty())
            },
        )
        onRearmed()
        controller.bindToLifecycle(lifecycleOwner)
        onDispose {
            // 相机资源随生命周期释放：离屏即解绑控制器并关闭识别器。
            controller.unbind()
            controller.clearImageAnalysisAnalyzer()
            scanner.close()
        }
    }
}
