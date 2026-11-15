// "Share to Quill" in the bottom row of the share sheet (the row with Copy, Print, Save to Files).
// It is a second app extension beside the share extension that expo-share-intent adds: an Action
// extension (com.apple.ui-services) that does exactly what the share extension does - puts the files
// where the app can read them and opens Quill, which then asks where they should go.
//
// It needs its own App ID and provisioning profile (bundle id <app>.action, with the app group), so it
// is only added when QUILL_ACTION=1 - see app.config.js.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const plist = require('@expo/plist').default;
const { withXcodeProject } = require('expo/config-plugins');

const TARGET = 'QuillAction';
const FILES = {
  source: 'QuillActionViewController.swift',
  storyboard: 'ActionInterface.storyboard',
  // In a folder of its own: the share extension has a file of the same name, and one reference shared by two
  // targets makes CocoaPods refuse the project ("no parent for object PrivacyInfo.xcprivacy").
  privacy: 'ActionPrivacy/PrivacyInfo.xcprivacy',
  assets: 'Assets.xcassets',
  info: 'QuillAction-Info.plist',
  entitlements: 'QuillAction.entitlements',
};

// ---- the icon: a pencil over a line, as a template image (iOS tints it itself)

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** Is the point (0...1, y down) part of the picture? */
function inGlyph(x, y) {
  const u = (x + (1 - y)) / 2;            // 0 at the bottom left corner, 1 at the top right
  const v = (x - (1 - y)) / Math.SQRT2;   // how far off that diagonal
  const half = 0.088;
  if (u >= 0.37 && u <= 0.78 && Math.abs(v) <= half) return true;                       // the barrel
  if (u >= 0.815 && u <= 0.88 && Math.abs(v) <= half) return true;                      // the end cap
  if (u >= 0.2 && u < 0.34 && Math.abs(v) <= half * ((u - 0.2) / 0.14)) return true;    // the point
  if (y >= 0.84 && y <= 0.885 && x >= 0.46 && x <= 0.86) return true;                   // the line it wrote
  return false;
}
function iconPng(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const ss = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hit = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) if (inGlyph((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size)) hit++;
      const at = py * (size * 4 + 1) + 1 + px * 4;
      raw[at] = 0; raw[at + 1] = 0; raw[at + 2] = 0; raw[at + 3] = Math.round((hit / (ss * ss)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const ICONS = [
  { idiom: 'iphone', size: '60x60', scale: '2x', px: 120 },
  { idiom: 'iphone', size: '60x60', scale: '3x', px: 180 },
  { idiom: 'ipad', size: '76x76', scale: '1x', px: 76 },
  { idiom: 'ipad', size: '76x76', scale: '2x', px: 152 },
  { idiom: 'ipad', size: '83.5x83.5', scale: '2x', px: 167 },
];

// ---- the files

function writeFiles(root, scheme, appId, group, activationRules) {
  const dir = path.join(root, TARGET);
  fs.mkdirSync(dir, { recursive: true });
  // The same view controller the share extension uses: it copies what was shared into the app group and opens the app.
  const template = fs.readFileSync(require.resolve('expo-share-intent/plugin/build/ios/ShareExtensionViewController.swift'), 'utf8');
  fs.writeFileSync(path.join(dir, FILES.source), template.replaceAll('<SCHEME>', scheme).replaceAll('<GROUPIDENTIFIER>', group).replaceAll('<HIDEVIEW>', 'true'));
  fs.writeFileSync(path.join(dir, FILES.storyboard), `<?xml version="1.0" encoding="UTF-8"?>
<document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB" version="3.0" toolsVersion="13122.16" targetRuntime="iOS.CocoaTouch" propertyAccessControl="none" useAutolayout="YES" useTraitCollections="YES" useSafeAreas="YES" colorMatched="YES" initialViewController="j1y-V4-xli">
    <dependencies>
        <plugIn identifier="com.apple.InterfaceBuilder.IBCocoaTouchPlugin" version="13104.12"/>
        <capability name="Safe area layout guides" minToolsVersion="9.0"/>
        <capability name="documents saved in the Xcode 8 format" minToolsVersion="8.0"/>
    </dependencies>
    <scenes>
        <scene sceneID="ceB-am-kn3">
            <objects>
                <viewController id="j1y-V4-xli" customClass="ShareViewController" customModuleProvider="target" sceneMemberID="viewController">
                    <view key="view" opaque="NO" contentMode="scaleToFill" id="wbc-yd-nQP">
                        <rect key="frame" x="0.0" y="0.0" width="375" height="667"/>
                        <autoresizingMask key="autoresizingMask" widthSizable="YES" heightSizable="YES"/>
                        <color key="backgroundColor" red="0.0" green="0.0" blue="0.0" alpha="0.0" colorSpace="custom" customColorSpace="sRGB"/>
                        <viewLayoutGuide key="safeArea" id="1Xd-am-t49"/>
                    </view>
                </viewController>
                <placeholder placeholderIdentifier="IBFirstResponder" id="CEy-Cv-SGf" userLabel="First Responder" sceneMemberID="firstResponder"/>
            </objects>
        </scene>
    </scenes>
</document>
`);
  fs.mkdirSync(path.join(dir, 'ActionPrivacy'), { recursive: true });
  fs.writeFileSync(path.join(dir, FILES.privacy), plist.build({
    NSPrivacyAccessedAPITypes: [{ NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] }],
    NSPrivacyCollectedDataTypes: [],
    NSPrivacyTracking: false,
  }));
  fs.writeFileSync(path.join(dir, FILES.entitlements), plist.build({ 'com.apple.security.application-groups': [group] }));
  fs.writeFileSync(path.join(dir, FILES.info), plist.build({
    CFBundleName: '$(PRODUCT_NAME)',
    CFBundleDisplayName: 'Share to Quill',
    CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)',
    CFBundleDevelopmentRegion: '$(DEVELOPMENT_LANGUAGE)',
    CFBundleExecutable: '$(EXECUTABLE_NAME)',
    CFBundleInfoDictionaryVersion: '6.0',
    CFBundlePackageType: '$(PRODUCT_BUNDLE_PACKAGE_TYPE)',
    NSExtension: {
      NSExtensionAttributes: { NSExtensionActivationRule: activationRules },
      NSExtensionMainStoryboard: 'ActionInterface',
      NSExtensionPointIdentifier: 'com.apple.ui-services',
    },
  }));
  const set = path.join(dir, FILES.assets, 'AppIcon.appiconset');
  fs.mkdirSync(set, { recursive: true });
  fs.writeFileSync(path.join(dir, FILES.assets, 'Contents.json'), JSON.stringify({ info: { author: 'xcode', version: 1 } }, null, 2));
  for (const i of ICONS) fs.writeFileSync(path.join(set, `action-${i.px}.png`), iconPng(i.px));
  fs.writeFileSync(path.join(set, 'Contents.json'), JSON.stringify({
    images: ICONS.map((i) => ({ idiom: i.idiom, size: i.size, scale: i.scale, filename: `action-${i.px}.png` })),
    info: { author: 'xcode', version: 1 },
  }, null, 2));
}

function teamOf(pbx) {
  const configs = pbx.pbxXCBuildConfigurationSection();
  for (const key in configs) {
    const bs = configs[key].buildSettings;
    if (!bs || !bs.PRODUCT_NAME) continue;
    const team = bs.DEVELOPMENT_TEAM && String(bs.DEVELOPMENT_TEAM).replace(/"/g, '');
    if (team) return team;
  }
  return null;
}

module.exports = function withShareAction(config, { activationRules } = {}) {
  const appId = config.ios?.bundleIdentifier;
  const group = `group.${appId}`;
  const bundleId = `${appId}.action`;
  const rules = activationRules ?? { NSExtensionActivationSupportsImageWithMaxCount: 20, NSExtensionActivationSupportsFileWithMaxCount: 10 };

  // EAS signs each extension it is told about.
  config.extra = config.extra ?? {};
  config.extra.eas = config.extra.eas ?? {};
  config.extra.eas.build = config.extra.eas.build ?? {};
  config.extra.eas.build.experimental = config.extra.eas.build.experimental ?? {};
  config.extra.eas.build.experimental.ios = config.extra.eas.build.experimental.ios ?? {};
  const list = (config.extra.eas.build.experimental.ios.appExtensions = config.extra.eas.build.experimental.ios.appExtensions ?? []);
  if (!list.some((e) => e.targetName === TARGET)) list.push({ targetName: TARGET, bundleIdentifier: bundleId, entitlements: { 'com.apple.security.application-groups': [group] } });

  return withXcodeProject(config, (cfg) => {
    const scheme = Array.isArray(cfg.scheme) ? cfg.scheme[0] : cfg.scheme;
    if (!scheme) throw new Error('[with-share-action] the app needs a URL scheme (expo.scheme)');
    writeFiles(cfg.modRequest.platformProjectRoot, scheme, appId, group, rules);
    const pbx = cfg.modResults;
    if (pbx.pbxTargetByName(TARGET)) return cfg;

    const sources = [FILES.source];
    const resources = [FILES.storyboard, FILES.privacy, FILES.assets];
    const group_ = pbx.addPbxGroup([...sources, ...resources, FILES.info, FILES.entitlements], TARGET, TARGET);
    const groups = pbx.hash.project.objects.PBXGroup;
    Object.keys(groups).forEach((key) => {
      if (typeof groups[key] === 'object' && groups[key].name === undefined && groups[key].path === undefined) pbx.addToPbxGroup(group_.uuid, key);
    });
    const objects = pbx.hash.project.objects;
    objects.PBXTargetDependency = objects.PBXTargetDependency || {};
    objects.PBXContainerItemProxy = objects.PBXContainerItemProxy || {};
    const target = pbx.addTarget(TARGET, 'app_extension', TARGET);
    pbx.addBuildPhase(sources, 'PBXSourcesBuildPhase', 'Sources', target.uuid);
    pbx.addBuildPhase(resources, 'PBXResourcesBuildPhase', 'Resources', target.uuid);
    pbx.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);

    const team = teamOf(pbx);
    const configs = pbx.pbxXCBuildConfigurationSection();
    for (const key in configs) {
      const bs = configs[key].buildSettings;
      if (!bs || bs.PRODUCT_NAME !== `"${TARGET}"`) continue;
      bs.CLANG_ENABLE_MODULES = 'YES';
      bs.INFOPLIST_FILE = `"${TARGET}/${FILES.info}"`;
      bs.CODE_SIGN_ENTITLEMENTS = `"${TARGET}/${FILES.entitlements}"`;
      bs.CODE_SIGN_STYLE = 'Automatic';
      bs.CURRENT_PROJECT_VERSION = `"${cfg.ios?.buildNumber || '1'}"`;
      bs.GENERATE_INFOPLIST_FILE = 'YES';
      bs.MARKETING_VERSION = `"${cfg.version}"`;
      bs.PRODUCT_BUNDLE_IDENTIFIER = `"${bundleId}"`;
      bs.SWIFT_EMIT_LOC_STRINGS = 'YES';
      bs.SWIFT_VERSION = '5.0';
      bs.TARGETED_DEVICE_FAMILY = '"1,2"';
      bs.ASSETCATALOG_COMPILER_APPICON_NAME = 'AppIcon';
      if (team) bs.DEVELOPMENT_TEAM = team;
    }
    if (team) pbx.addTargetAttribute('DevelopmentTeam', team, pbx.pbxTargetByName(TARGET));
    return cfg;
  });
};

module.exports.iconPng = iconPng;
