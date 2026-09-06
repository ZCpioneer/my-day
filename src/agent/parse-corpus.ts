/** 解析语料：随口一说 vs 真正待办、短期任务 vs 长期记忆 的判断基准。
 *  两个消费者：parse-corpus.test.ts（完整性）、eval/parse.eval.test.ts（真实 API 打分）。 */
export interface CorpusCase {
  input: string;
  note?: string;
  expect: {
    /** 应抽出的 task 标题关键词（包含匹配）。 */
    tasks?: string[];
    /** 不得成为 task 的表述。 */
    notTasks?: string[];
    /** 应记为 event 的关键词。 */
    events?: string[];
    decisions?: string[];
    waitings?: string[];
    memories?: { text: string; kind: "preference" | "goal" | "watch" }[];
    notMemories?: string[];
    /** 六类应全空。 */
    chitchat?: boolean;
  };
}

export const PARSE_CORPUS: CorpusCase[] = [
  // —— 随口一说 ≠ 真正待办 ——
  { input: "好想去看海啊", expect: { chitchat: true, notTasks: ["看海"], notMemories: ["看海"] } },
  { input: "要是有空真想学吉他", expect: { chitchat: true, notTasks: ["学吉他"], notMemories: ["吉他"] } },
  { input: "今天累死了，啥也不想干", expect: { events: ["累"], notTasks: ["累"], notMemories: ["累"] } },
  { input: "中午吃了螺蛳粉，太辣了", expect: { events: ["螺蛳粉"], notTasks: ["螺蛳粉"] } },
  { input: "我同事要跳槽了", expect: { events: ["同事"], notTasks: ["跳槽"] } },
  { input: "下周可能想出去走走", expect: { chitchat: true, notTasks: ["出去走走"] } },
  { input: "哈哈今天天气真好", expect: { chitchat: true } },
  { input: "你说我该不该换工作啊", expect: { chitchat: true, notTasks: ["换工作"] } },

  // —— 真正待办 ——
  { input: "明天下午三点前得把稿子交给编辑", expect: { tasks: ["稿"], notMemories: ["稿"] } },
  { input: "记得给妈妈回电话", expect: { tasks: ["回电话"] } },
  { input: "周五之前把车险续了，很急", expect: { tasks: ["车险"] } },
  { input: "晚上把垃圾带下楼", expect: { tasks: ["垃圾"] } },
  { input: "明天记得带伞，要下雨", expect: { tasks: ["带伞"], events: ["下雨"] } },

  // —— 短期任务 vs 长期记忆 ——
  {
    input: "以后早上别给我排会，我上午要写代码",
    expect: { memories: [{ text: "早上", kind: "preference" }], notTasks: ["排会"] },
  },
  { input: "今年要把小说初稿写完", expect: { memories: [{ text: "初稿", kind: "goal" }], notTasks: ["初稿"] } },
  { input: "帮我留意膝盖恢复的情况", expect: { memories: [{ text: "膝盖", kind: "watch" }], notTasks: ["膝盖"] } },
  { input: "年底想瘦五公斤", expect: { memories: [{ text: "瘦", kind: "goal" }] } },

  // —— 决定 / 事件 ——
  { input: "定了，数据库就用 Postgres", expect: { decisions: ["Postgres"], notTasks: ["Postgres"] } },
  {
    input: "今天开始戒糖",
    note: "边界：是决定；也可能被当成长期目标，二者都算对，但不许是 task",
    expect: { decisions: ["戒糖"], notTasks: ["戒糖"] },
  },

  // —— 项目 / 等待 ——
  {
    input: "朝暮项目的解析层联调完了，明天开始接 UI",
    expect: { events: ["联调"], tasks: ["接 UI"] },
  },
  { input: "房东说下周三前给我答复", expect: { waitings: ["答复"], notTasks: ["答复"] } },
  { input: "出版社还没回我邮件", expect: { waitings: ["邮件"] } },
  { input: "他回复我了，房租维持不变", note: "边界：独立一句话，至少应记 event", expect: { events: ["房租"] } },
];
