/** 解析语料：随口一说 vs 真正待办 的判断基准。
 *  两个消费者：parse-corpus.test.ts（完整性）、eval/parse.eval.test.ts（真实 API 打分）。
 *  注意：本应用不做长期记忆——偏好/目标/感慨类输入的正确结果是「什么都不抽」（chitchat）。 */
export interface CorpusCase {
  input: string;
  note?: string;
  /** 最近对话（不含本条），模拟用户正在回答秘书的引导提问。 */
  context?: { role: "user" | "assistant"; content: string }[];
  expect: {
    /** 应抽出的 task 标题关键词（包含匹配）。 */
    tasks?: string[];
    /** 不得成为 task 的表述。 */
    notTasks?: string[];
    /** 应记为 event 的关键词。 */
    events?: string[];
    decisions?: string[];
    waitings?: string[];
    /** 至少一条 task 应带上的 project 关键词。 */
    projects?: string[];
    /** 指定 task 应解析出的预估耗时（分钟）。 */
    estimates?: { task: string; minutes: number }[];
    /** 全空： events/decisions/tasks/projectUpdates/waitings/waitingsResolved 都没有。 */
    chitchat?: boolean;
  };
}

export const PARSE_CORPUS: CorpusCase[] = [
  // —— 随口一说 ≠ 真正待办 ——
  { input: "好想去看海啊", expect: { chitchat: true, notTasks: ["看海"] } },
  { input: "要是有空真想学吉他", expect: { chitchat: true, notTasks: ["学吉他"] } },
  { input: "今天累死了，啥也不想干", expect: { events: ["累"], notTasks: ["累"] } },
  { input: "中午吃了螺蛳粉，太辣了", expect: { events: ["螺蛳粉"], notTasks: ["螺蛳粉"] } },
  { input: "我同事要跳槽了", expect: { events: ["同事"], notTasks: ["跳槽"] } },
  { input: "下周可能想出去走走", expect: { chitchat: true, notTasks: ["出去走走"] } },
  { input: "哈哈今天天气真好", expect: { chitchat: true } },
  { input: "你说我该不该换工作啊", expect: { chitchat: true, notTasks: ["换工作"] } },

  // —— 真正待办 ——
  { input: "明天下午三点前得把稿子交给编辑", expect: { tasks: ["稿"] } },
  { input: "记得给妈妈回电话", expect: { tasks: ["回电话"] } },
  { input: "周五之前把车险续了，很急", expect: { tasks: ["车险"] } },
  { input: "晚上把垃圾带下楼", expect: { tasks: ["垃圾"] } },
  { input: "明天记得带伞，要下雨", expect: { tasks: ["带伞"], events: ["下雨"] } },

  // —— 偏好/目标/感慨：不落任何库（没有记忆层） ——
  { input: "以后早上别给我排会，我上午要写代码", note: "边界：是偏好，但没有记忆层，不该变 task", expect: { chitchat: true, notTasks: ["排会"] } },
  { input: "今年要把小说初稿写完", note: "边界：是长期目标，不该变今天的 task", expect: { chitchat: true, notTasks: ["初稿"] } },
  { input: "帮我留意膝盖恢复的情况", note: "边界：持续关注类，无处安放就不放", expect: { chitchat: true, notTasks: ["膝盖"] } },
  { input: "年底想瘦五公斤", expect: { chitchat: true, notTasks: ["瘦"] } },

  // —— 决定 / 事件 ——
  { input: "定了，数据库就用 Postgres", expect: { decisions: ["Postgres"], notTasks: ["Postgres"] } },
  {
    input: "今天开始戒糖",
    note: "边界：是当天决定；不许是 task",
    expect: { decisions: ["戒糖"], notTasks: ["戒糖"] },
  },

  // —— 项目 / 等待 ——
  {
    input: "新 App 的解析层联调完了，明天开始接 UI",
    expect: { events: ["联调"], tasks: ["接 UI"] },
  },
  { input: "房东说下周三前给我答复", expect: { waitings: ["答复"], notTasks: ["答复"] } },
  { input: "出版社还没回我邮件", expect: { waitings: ["邮件"] } },
  { input: "他回复我了，房租维持不变", note: "边界：独立一句话，至少应记 event", expect: { events: ["房租"] } },

  // —— 耗时 / 承接回答（对话上下文参与解析） ——
  {
    input: "下午得去趟银行办房贷，估计要一个半小时",
    expect: { tasks: ["银行"], estimates: [{ task: "银行", minutes: 90 }] },
  },
  {
    input: "我要做一个AI视频",
    note: "边界：承诺（我要做）≠ 愿望（好想），承诺是 task",
    expect: { tasks: ["视频"] },
  },
  {
    context: [
      { role: "user", content: "我要做一个AI视频的事情" },
      { role: "assistant", content: "这摊事要拆成哪几步？" },
    ],
    input: "拆成两步吧：先写脚本，再生成画面",
    note: "回答拆分提问：每一步都抽成 task，并带上上下文里的归属",
    expect: { tasks: ["脚本", "画面"], projects: ["视频"] },
  },
  {
    context: [{ role: "assistant", content: "装修这摊事，要拆成哪几步？" }],
    input: "先买瓷砖，再约师傅量尺寸",
    note: "回答拆分提问：两步都该带上归属项目",
    expect: { tasks: ["瓷砖", "师傅"], projects: ["装修"] },
  },
  {
    context: [{ role: "assistant", content: "买瓷砖这件事，属于哪摊事？" }],
    input: "装修那摊",
    note: "边界：纯归属回答不产生新 task（改已有任务的归属在待办页拖拽完成）",
    expect: { notTasks: ["装修"] },
  },
];
