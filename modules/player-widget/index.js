import { requireNativeModule } from 'expo-modules-core';

// 홈/잠금화면 위젯과 playback.js 사이를 잇는다. update() 로 지금 재생 상태를
// 밀어 주고, onWidgetAction 이벤트로 위젯 버튼(재생/이전/다음) 을 받는다.
let module_ = null;
try {
  module_ = requireNativeModule('PlayerWidget');
} catch {
  module_ = null;
}

export default module_;
