import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// 纯 JVM 逻辑模块：零安卓依赖、零第三方运行时依赖（契约用回调而非 Flow）。
// 编译期 import 不到 android.*，故无设备可测——纯逻辑单测即在此模块。
plugins {
    alias(libs.plugins.kotlin.jvm)
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

// 仓根 golden/ 是夹具唯一副本：挂为 test resources，测试经 classpath 读取。
sourceSets {
    test {
        resources.srcDir("../../golden")
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}
