import { requireNativeModule } from 'expo-modules-core';

// TTS 음성을 WAV 로 합성해 폰의 Music/스텝바이 폴더에 저장하는 네이티브 모듈.
// expo-speech 에는 파일로 저장하는 기능이 없어서 직접 붙였다.
// 네이티브가 빠진 환경(Expo Go 등)에서는 null 이 되고, 화면에서 저장 버튼이 잠긴다.
let module_ = null;
try {
  module_ = requireNativeModule('TtsFile');
} catch {
  module_ = null;
}

export default module_;
