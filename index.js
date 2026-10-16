import { AppRegistry } from 'react-native';
import { registerRootComponent } from 'expo';

import App from './App';
import { resumeFromWidget } from './src/playback';

// 앱이 완전히 꺼져 있을 때 위젯 버튼을 누르면, 화면 없이 이 작업만 깨어나서
// 마지막으로 듣던 곳부터 이어 재생한다(modules/player-widget 의 WidgetPlaybackService).
AppRegistry.registerHeadlessTask('StepbyWidgetTask', () => async ({ action }) => {
  await resumeFromWidget(action, { headless: true });
  // 재생 알림(잠금화면 컨트롤)이 붙을 시간을 조금 준 뒤 작업을 끝낸다
  await new Promise((resolve) => setTimeout(resolve, 6000));
});

registerRootComponent(App);
