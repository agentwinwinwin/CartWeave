type ScheduleRelease = {scope:string;input_mode:string|null};

// Mirrors the backend's event-listener rule; never rewrites frozen configuration.
export function continuousScheduleAvailable(release?:ScheduleRelease):boolean {
  return release?.scope==='support'&&release.input_mode==='inbox';
}

export function continuousScheduleHint(release?:ScheduleRelease):string {
  if(continuousScheduleAvailable(release))return '每 15 秒检查新消息，每条执行一轮完整客服流程；无消息时不调用模型。';
  if(release?.scope==='support')return '当前客服版本只处理一条固定消息。请在客服首节点选择“持续接收新消息”，保存并重新冻结，再回来选择新版本。';
  return '一直执行用于智能客服的新消息监听，不是无间隔重复执行选品、同一订单或同一批商品图。请先选择持续收件箱模式的客服冻结版本。';
}
