# Release 启用 R8；JNI/绑定保留规则由引擎 AAR 的 consumer rules 单一提供。
# 本文件仅容纳应用自身且由 release 构建或运行证据证明必要的规则。

# JNA 的 libjnidispatch.so 会按固定字段/方法名反射 Java 侧桥接类型；R8 改名会导致 Native.initIDs 崩溃。
-keep class com.sun.jna.** { *; }

# Release 包内隐藏源码文件名，同时保留行号与 R8 mapping 供崩溃栈 retrace。
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
-keepclassmembers class * extends com.sun.jna.Structure { *; }
-dontwarn com.sun.jna.**
