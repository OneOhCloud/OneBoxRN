const { withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Expo config plugin to add OneBoxMTunnel Network Extension target
 * 在每次 prebuild 后自动运行 Ruby 脚本添加扩展 target
 */
const withOneBoxMTunnel = (config) => {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const iosDir = path.join(projectRoot, 'ios');
      const scriptPath = path.join(projectRoot, 'src', 'modules', 'expo-onebox', 'ios', 'add_onebox_tunnel.rb');
      
      console.log('[withOneBoxMTunnel] 正在配置 Network Extension...');
      console.log(`[withOneBoxMTunnel] iOS 目录: ${iosDir}`);
      console.log(`[withOneBoxMTunnel] 脚本路径: ${scriptPath}`);
      
      try {
        // 运行 Ruby 脚本，传入 iOS 目录路径
        execSync(`ruby "${scriptPath}" "${iosDir}"`, {
          stdio: 'inherit',
          cwd: projectRoot,
        });
        console.log('[withOneBoxMTunnel] ✅ Network Extension 配置成功');
      } catch (error) {
        console.error('[withOneBoxMTunnel] ❌ 配置失败:', error.message);
        // 不抛出错误，允许构建继续
      }
      
      return config;
    },
  ]);
};

module.exports = withOneBoxMTunnel;
