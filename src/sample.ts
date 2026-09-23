// 航天器供电系统示例：一次电源母线 S 由主路或备份路供电；
// 共享子门 LOSS（两路公用）同时被主路/备份引用，用于演示共享 DAG 去重。
export const SAMPLE_EVENTS = `# 每行一个基本事件（2-30 个，ASCII 标识）
BUS_FAULT      # 母线本体失效
MAIN_SRC       # 主电源失效
MAIN_SW        # 主路开关失效
BK_SRC         # 备份电源失效
BK_SW          # 备份开关失效
COMMON_CTRL    # 公用控制单元失效（两路共享单点）
COSMIC         # 无关的宇宙射线测量通道，不接入任何门
`;

export const SAMPLE_GATES = `# 每行：门名 AND|OR 输入...（输入可为基本事件或其他门）
# 共享子门 LOSS 同时被主路 MAINF 与备份路 BKF 引用，仅规范化一次
LOSS   OR  COMMON_CTRL BUS_FAULT
# 主路供电失效：主电源或主开关失效，且共享子门失效
MAINF  AND OR_MAIN LOSS
OR_MAIN OR MAIN_SRC MAIN_SW
# 备份路供电失效
BKF    AND OR_BK LOSS
OR_BK  OR BK_SRC BK_SW
# 顶事件：主路与备份路同时失效
TOP    AND MAINF BKF
`;

export const SAMPLE_TOP = 'TOP';
