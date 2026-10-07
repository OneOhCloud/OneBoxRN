import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.androidx.baselineprofile)
    alias(libs.plugins.kotlin.compose)
}

// 仓根 .env（gitignored）读键注入 BuildConfig：config= 仅注入 debug 的 CONFIG_URL（明文 URL 绝不
// 进入源码或 release 构建）；website=/privacy= 注入两构建型的外链 URL
//（明文只存 .env；缺键即空串，装配期 require 崩溃暴露）。
// accelerate= 同源注入，但**可缺**：空串 = 加速代理未配置，回落判定恒不成立。
fun repoRootEnv(key: String): String {
    val envFile = rootProject.file("../.env")
    if (!envFile.exists()) return ""
    for (raw in envFile.readLines()) {
        val line = raw.trim()
        if (line.isEmpty() || line.startsWith("#")) continue
        val separator = line.indexOf('=')
        if (separator > 0 && line.substring(0, separator).trim() == key) {
            return line.substring(separator + 1).trim()
        }
    }
    return ""
}

fun String.asJavaStringLiteral(): String = "\"" + replace("\\", "\\\\").replace("\"", "\\\"") + "\""

// 引擎版本的唯一声明处是 engine/Makefile 的 UPSTREAM_TAG；UI 进程读它而不加载引擎原生库。
fun engineVersion(): String {
    val makefile = rootProject.file("../engine/Makefile")
    val tag = makefile.readLines().firstNotNullOfOrNull { line ->
        Regex("""^UPSTREAM_TAG\s*:=\s*v?(\S+)\s*$""").find(line)?.groupValues?.get(1)
    }
    return requireNotNull(tag) { "engine/Makefile must declare UPSTREAM_TAG" }
}

// 出货 ABI 的唯一声明处是 engine/Makefile 的 ANDROID_RELEASE_ABIS；引擎 AAR 按同一份清单编译。
fun engineReleaseAbis(): List<String> {
    val makefile = rootProject.file("../engine/Makefile")
    val abis = makefile.readLines().firstNotNullOfOrNull { line ->
        Regex("""^ANDROID_RELEASE_ABIS\s*:=\s*(.+?)\s*$""").find(line)?.groupValues?.get(1)
    }
    return requireNotNull(abis) { "engine/Makefile must declare ANDROID_RELEASE_ABIS" }.split(Regex("""\s+"""))
}

// 路由模板资产的构建期兜底。
//
// 模板是 gitignored 的构建期资产（`make templates` 从 .env 的两个 URL 拉取），干净检出与新建
// worktree 里都不存在。缺了它编译**照样通过**——要到用户点连接、读 assets 才炸。故与 iOS 的
// 同名构建期检查同一姿态：缺文件即构建失败，把这条错误提前到编译期。
val checkTemplateAssets =
    tasks.register("checkTemplateAssets") {
        val templates = listOf("tun-rules.json", "tun-global.json")
            .map { layout.projectDirectory.file("src/main/assets/templates/$it") }
        inputs.files(templates.map { it.asFile.path })
        doLast {
            val missing = templates.map { it.asFile }.filter { !it.isFile || it.length() == 0L }
            check(missing.isEmpty()) {
                missing.joinToString(
                    prefix = "缺路由模板资产，跑 `make templates`：\n  ",
                    separator = "\n  ",
                ) { it.path }
            }
        }
    }

tasks.named("preBuild") { dependsOn(checkTemplateAssets) }

// 自绘图标：Fluent 里没有的几枚按它的笔法（24 网格、Regular 线形）画在仓根 assets/icons，
// Android 与 Windows 都从那份 SVG 派生，仓里不留第二份。本任务把它转成 `ic_drawn_<名>` 矢量资源。
//
// 只收一个与 VectorDrawable 一一对应的子集：viewBox 0 0 24 24、只有 <path d fill-rule>、纯填充。
// 子集之外的写法直接让构建失败——静默丢掉一个属性，画出来的就是另一枚图标。
abstract class GenerateDrawnIconsTask : DefaultTask() {
    @get:InputDirectory
    abstract val sourceDir: DirectoryProperty

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun generate() {
        val drawables = outputDir.get().dir("drawable").asFile
        drawables.deleteRecursively()
        drawables.mkdirs()
        val sources = sourceDir.get().asFile.listFiles { file -> file.extension == "svg" }.orEmpty()
        check(sources.isNotEmpty()) { "assets/icons has no svg" }
        for (source in sources.sortedBy { it.name }) {
            drawables.resolve("ic_drawn_${source.nameWithoutExtension}.xml").writeText(vectorOf(source))
        }
    }

    private fun vectorOf(source: File): String {
        fun ensure(condition: Boolean, reason: () -> String) = check(condition) { "${source.name}: ${reason()}" }
        ensure(Regex("[a-z][a-z0-9_]*").matches(source.nameWithoutExtension)) { "icon name must be snake_case" }
        val parser = javax.xml.parsers.DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }
        val root = parser.newDocumentBuilder().parse(source).documentElement
        ensure(root.localName == "svg" && root.namespaceURI == "http://www.w3.org/2000/svg") { "root must be svg" }
        ensure(root.getAttribute("viewBox") == "0 0 24 24") { "viewBox must be 0 0 24 24" }
        for (index in 0 until root.attributes.length) {
            val attribute = root.attributes.item(index).nodeName
            ensure(attribute in setOf("xmlns", "viewBox", "width", "height")) { "unsupported svg attribute $attribute" }
        }
        val paths = StringBuilder()
        for (index in 0 until root.childNodes.length) {
            val node = root.childNodes.item(index)
            if (node.nodeType == org.w3c.dom.Node.TEXT_NODE && node.textContent.isBlank()) continue
            ensure(node is org.w3c.dom.Element && node.localName == "path") { "only <path> is allowed" }
            for (attributeIndex in 0 until node.attributes.length) {
                val attribute = node.attributes.item(attributeIndex).nodeName
                ensure(attribute == "d" || attribute == "fill-rule") { "unsupported path attribute $attribute" }
            }
            val data = (node as org.w3c.dom.Element).getAttribute("d")
            ensure(Regex("[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\\-\\s]+").matches(data)) { "malformed path data" }
            val fillType = when (node.getAttribute("fill-rule")) {
                "", "nonzero" -> "nonZero"
                "evenodd" -> "evenOdd"
                else -> error("${source.name}: unsupported fill-rule")
            }
            paths.append("    <path android:fillColor=\"#FF000000\" android:fillType=\"$fillType\"\n")
            paths.append("        android:pathData=\"$data\" />\n")
        }
        ensure(paths.isNotEmpty()) { "no path" }
        return "<vector xmlns:android=\"http://schemas.android.com/apk/res/android\"\n" +
            "    android:width=\"24dp\" android:height=\"24dp\"\n" +
            "    android:viewportWidth=\"24\" android:viewportHeight=\"24\">\n" +
            paths +
            "</vector>\n"
    }
}

val generateDrawnIcons = tasks.register<GenerateDrawnIconsTask>("generateDrawnIcons") {
    sourceDir.set(rootProject.file("../assets/icons"))
}

androidComponents {
    onVariants { variant ->
        variant.sources.res?.addGeneratedSourceDirectory(generateDrawnIcons, GenerateDrawnIconsTask::outputDir)
    }
}
val versionProperties = Properties().apply {
    rootProject.file("app/version.properties").inputStream().use { load(it) }
}
val androidVersionCode = requireNotNull(versionProperties.getProperty("versionCode")?.toIntOrNull()) {
    "app/version.properties versionCode must be an integer"
}
val androidVersionName = requireNotNull(versionProperties.getProperty("versionName")?.takeIf { it.isNotBlank() }) {
    "app/version.properties versionName must be non-empty"
}

android {
    namespace = "cloud.oneoh.oneboxn"
    compileSdk = 36
    buildToolsVersion = libs.versions.buildTools.get()

    defaultConfig {
        applicationId = "cloud.oneoh.networktools"
        minSdk = 28
        targetSdk = 36
        versionCode = androidVersionCode
        versionName = androidVersionName
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // 默认空串——release 不携带配置 URL。
        buildConfigField("String", "CONFIG_URL", "\"\"")

        // 关于外链：两构建型同源注入。
        buildConfigField("String", "WEBSITE_URL", repoRootEnv("website").asJavaStringLiteral())
        buildConfigField("String", "PRIVACY_URL", repoRootEnv("privacy").asJavaStringLiteral())
        // 加速代理 base URL：**可选键**——缺失即空串，回落判定恒不成立，
        // 不走外链那种「缺键即崩溃暴露」。加速代理本就允许不配置。
        buildConfigField("String", "ACCELERATE_URL", repoRootEnv("accelerate").asJavaStringLiteral())
        buildConfigField("String", "ENGINE_VERSION", engineVersion().asJavaStringLiteral())
    }

    // 分发渠道只有商店一个：商店分发的应用不得自我更新，应用只问商店有无更新、把用户带去商店页。
    // 维度留着是为了把商店专属的依赖与实现收在 play 源集里。
    flavorDimensions += "distribution"
    productFlavors {
        create("play") {
            dimension = "distribution"
        }
    }

    buildTypes {
        debug {
            buildConfigField("String", "CONFIG_URL", repoRootEnv("config").asJavaStringLiteral())
        }
        release {
            isDebuggable = false
            isJniDebuggable = false
            isMinifyEnabled = true
            isShrinkResources = true
            ndk {
                abiFilters += engineReleaseAbis()
                debugSymbolLevel = "SYMBOL_TABLE"
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    signingConfigs {
        create("store") {
            val storeFilePath = repoRootEnv("android_keystore_file")
            if (storeFilePath.isNotBlank()) storeFile = file(storeFilePath)
            storePassword = repoRootEnv("android_keystore_password")
            keyAlias = repoRootEnv("android_key_alias")
            keyPassword = repoRootEnv("android_key_password")
        }
    }

    buildTypes.getByName("release") {
        if (repoRootEnv("android_keystore_file").isNotBlank()) {
            signingConfig = signingConfigs.getByName("store")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    // 缺翻译即报错（en 与 zh 键集必须一致）。
    lint {
        error += "MissingTranslation"
    }
}

dependencies {
    implementation(project(":core"))
    // 引擎原生库（make engine-android 产出，gitignored）；只有 :tun 侧绑定文件调用其符号。
    implementation(files("libs/engine.aar"))
    implementation(libs.core.ktx)
    // 整包依赖上游发布的构件：release 的资源压缩只留下被引用的那几枚文件，代价是资源表里的 ID（约 +1.7 MB）。
    implementation(libs.fluent.icons)
    implementation(libs.work.runtime.ktx)
    "playImplementation"(libs.play.app.update)
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.lifecycle.runtime.compose)
    // 扫码相机（CameraX 控制器 + PreviewView）与识别分析器桥；条码模型 bundled（不依赖 GMS 动态下载）。
    implementation(libs.camera.camera2)
    implementation(libs.camera.lifecycle)
    implementation(libs.camera.view)
    implementation(libs.camera.mlkit.vision)
    implementation(libs.mlkit.barcode.scanning)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.coroutines.core)
    implementation(libs.profileinstaller)
    // 纯逻辑单测（heroState 推导 / 导入相位映射；与 :core 同版本 JUnit）。
    testImplementation(libs.junit)
    // ViewModel 单测的主调度器替身（viewModelScope 走 Dispatchers.Main）。
    testImplementation(libs.coroutines.test)
    androidTestImplementation(libs.test.ext.junit)
    androidTestImplementation(libs.test.runner)
    baselineProfile(project(":benchmark"))
}

baselineProfile {
    automaticGenerationDuringBuild = false
}

// 为什么这个类必须独占一个 JVM，写在它自己的类注释里（`UnawaitedCoroutineFailureTest`）；
// 这里只留机械的两件：主 task 具名排除它、另起一个 task 单独跑它。
//
// 放在 `afterEvaluate` 里而不是文件上半部：AGP 的单测 task 是在它自己的 afterEvaluate 里建的，
// 脚本求值期去 `tasks.named("testPlayDebugUnitTest")` 会直接「task not found」。
val leakyByDesignTest = "cloud.oneoh.oneboxn.bridge.UnawaitedCoroutineFailureTest"

afterEvaluate {
    tasks.named<Test>("testPlayDebugUnitTest") {
        // **具名单个类，不用模式匹配**：`*FailureTest*` 之类会把将来同名的新测试一起静默吃掉，
        // 那是另一种无声漏跑。
        filter { excludeTestsMatching(leakyByDesignTest) }
    }

    tasks.register<Test>("testPlayDebugUnitTestIsolated") {
        val host = tasks.named<Test>("testPlayDebugUnitTest")
        dependsOn(host)
        group = "verification"
        description = "单独一个 JVM 跑 $leakyByDesignTest（它按设计会污染同 JVM 的后续测试）"
        testClassesDirs = files(host.map { it.testClassesDirs })
        classpath = files(host.map { it.classpath })
        filter {
            includeTestsMatching(leakyByDesignTest)
            // 类被改名或挪走时**响亮失败**，而不是静默跑 0 条 —— 静默跑 0 条会让上面那道
            // 排除同时悄悄失效（名字对不上就等于没排除），于是污染无声无息地回来。
            isFailOnNoMatchingTests = true
        }
    }
}
