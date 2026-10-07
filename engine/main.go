// 引擎构建驱动：调用 gomobile bind 为 Android / Apple 构建上游内核原生库。
// 本文件是上游「库构建命令」的入口覆盖（cp 到 upstream/cmd/internal/build_libbox）。
// 它掌控编译进原生库的组件集（build tags）与构建参数，替换上游默认入口。
//
// 命名说明：本文件位于豁免的 engine/ 目录，允许出现上游包名/符号（见根 Makefile check-naming）。
// Android 侧用 -javapkg cloud.oneoh 使消费方 import 前缀中立为 cloud.oneoh.*；
// Apple 侧产物落位时更名为 Engine.xcframework。残余上游符号只在四个引擎绑定文件与唯一链接锚被引用。
package main

import (
	"flag"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	_ "github.com/sagernet/gomobile"
	"github.com/sagernet/sing-box/cmd/internal/build_shared"
	"github.com/sagernet/sing-box/log"
	E "github.com/sagernet/sing/common/exceptions"
	"github.com/sagernet/sing/common/rw"
	"github.com/sagernet/sing/common/shell"
)

// 构建参数单一来源（本文件）：javapkg 前缀、Android 最低 API、产物名、落位路径。
// 上游版本 tag 不在此声明——唯一声明处是 engine/Makefile。
const (
	javaPkgPrefix    = "cloud.oneoh"
	androidMinAPI    = 28     // 对齐 Android 应用的 minSdk=28
	appleMinIOS      = "18.0" // 对齐 iOS 部署目标
	androidOutput    = "engine.aar"
	appleFramework   = "Engine.xcframework"
	appleUpstreamOut = "Libbox.xcframework" // gomobile 依 -libname=box 产出，落位时更名
)

var (
	debugEnabled bool
	target       string
	platform     string
)

func init() {
	flag.BoolVar(&debugEnabled, "debug", false, "enable debug")
	flag.StringVar(&target, "target", "android", "target platform")
	flag.StringVar(&platform, "platform", "", "specify gomobile bind platform list")
}

func main() {
	flag.Parse()

	build_shared.FindMobile()

	switch target {
	case "android":
		buildAndroid()
	case "apple":
		buildApple()
	}
}

var (
	sharedFlags []string
	debugFlags  []string
	sharedTags  []string
	darwinTags  []string
	debugTags   []string
)

func init() {
	sharedFlags = append(sharedFlags, "-trimpath")
	sharedFlags = append(sharedFlags, "-buildvcs=false")
	currentTag, err := build_shared.ReadTag()
	if err != nil {
		currentTag = "unknown"
	}
	sharedFlags = append(sharedFlags, "-ldflags", build_shared.LinkerFlags(currentTag, false))
	debugFlags = append(debugFlags, "-ldflags", build_shared.LinkerFlags(currentTag, true))

	sharedTags = append(sharedTags, "with_gvisor", "with_quic", "with_wireguard", "with_utls", "with_naive_outbound", "with_clash_api", "with_usbip", "with_openvpn", "with_openconnect", "badlinkname", "tfogo_checklinkname0")
	darwinTags = append(darwinTags, "with_dhcp", "grpcnotrace")
	sharedTags = append(sharedTags, "with_tailscale", "ts_omit_logtail", "ts_omit_ssh", "ts_omit_drive", "ts_omit_taildrop", "ts_omit_webclient", "ts_omit_doctor", "ts_omit_capture", "ts_omit_kube", "ts_omit_aws", "ts_omit_synology", "ts_omit_bird")
	debugTags = append(debugTags, "debug")
}

func checkJavaVersion() {
	var javaPath string
	javaHome := os.Getenv("JAVA_HOME")
	if javaHome == "" {
		javaPath = "java"
	} else {
		javaPath = filepath.Join(javaHome, "bin", "java")
	}

	javaVersion, err := shell.Exec(javaPath, "--version").ReadOutput()
	if err != nil {
		log.Fatal(E.Cause(err, "check java version"))
	}
	if !strings.Contains(javaVersion, "openjdk 17") && !strings.Contains(javaVersion, "openjdk 21") {
		log.Fatal("java version should be openjdk 17 or 21")
	}
}

func getAndroidBindTarget() string {
	if platform != "" {
		return platform
	} else if debugEnabled {
		return "android/arm64"
	}
	return "android"
}

func buildAndroid() {
	build_shared.FindSDK()
	checkJavaVersion()
	prepareGomobileWorkspace(androidOutput)

	bindTarget := getAndroidBindTarget()

	tags := append([]string{}, sharedTags...)
	if debugEnabled {
		tags = append(tags, debugTags...)
	}

	args := []string{
		"bind",
		"-v",
		"-o", androidOutput,
		"-target", bindTarget,
		"-androidapi", strconv.Itoa(androidMinAPI),
		"-javapkg=" + javaPkgPrefix,
		"-libname=box",
	}
	if !debugEnabled {
		args = append(args, sharedFlags...)
	} else {
		args = append(args, debugFlags...)
	}
	args = append(args, "-tags", strings.Join(tags, ","))
	args = append(args, "./experimental/libbox")

	runGomobile(args)
}

func buildApple() {
	prepareGomobileWorkspace(appleUpstreamOut)

	var bindTarget string
	if platform != "" {
		bindTarget = platform
	} else if debugEnabled {
		bindTarget = "ios"
	} else {
		bindTarget = "ios,iossimulator"
	}

	args := []string{
		"bind",
		"-v",
		"-target", bindTarget,
		"-libname=box",
		"-tags-not-macos=with_low_memory",
		"-iosversion=" + appleMinIOS,
	}
	if !debugEnabled {
		args = append(args, sharedFlags...)
	} else {
		args = append(args, debugFlags...)
	}

	tags := append([]string{}, sharedTags...)
	tags = append(tags, darwinTags...)
	if debugEnabled {
		tags = append(tags, debugTags...)
	}
	args = append(args, "-tags", strings.Join(tags, ","))
	args = append(args, "./experimental/libbox")

	runGomobile(args)

	// 落位并更名为中立产物名：engine/upstream 为 CWD，../.. 即仓库根 → ios/。
	copyPath := filepath.Join("..", "..", "ios")
	if rw.IsDir(copyPath) {
		targetDir, _ := filepath.Abs(filepath.Join(copyPath, appleFramework))
		os.RemoveAll(targetDir)
		if err := os.Rename(appleUpstreamOut, targetDir); err != nil {
			log.Fatal(E.Cause(err, "land ", appleFramework))
		}
		log.Info("landed ", appleFramework, " to ", targetDir)
	} else {
		log.Warn("landing dir not found, left ", appleUpstreamOut, " in place: ", copyPath)
	}
}

func runGomobile(args []string) {
	command := exec.Command(build_shared.GoBinPath+"/gomobile", args...)
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	if err := command.Run(); err != nil {
		log.Fatal(err)
	}
}

func prepareGomobileWorkspace(outputs ...string) {
	paths := append([]string{"build"}, outputs...)
	for _, path := range paths {
		if err := os.RemoveAll(path); err != nil {
			log.Fatal(E.Cause(err, "prepare gomobile workspace: remove ", path))
		}
	}
}
