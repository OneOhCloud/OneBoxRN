package cloud.oneoh.oneboxn.core

/**
 * 节点延迟档位判定。
 *
 * 只分档、不定色：档位到语义色的映射属呈现层（色值只出 Theme），
 * 两端 UI 各自把同一档位映射到各自主题。阈值在此处唯一声明。
 */
object NodeLatency {

    /** 档位。`NONE` 是「无探测数值」，与「很慢」是两回事——呈现上前者是破折号，后者是数值。 */
    enum class Tier {
        NONE, GOOD, FAIR, POOR;

        /** 小写 token（golden 夹具与日志用）。 */
        val token: String get() = name.lowercase()
    }

    /** 良好档上界（含）。 */
    const val GOOD_MAX_MS = 300

    /** 一般档上界（含）；超出即差档。 */
    const val FAIR_MAX_MS = 900

    /** 非正数视为无数据——引擎以 0 表示「尚无成功探测样本」，负数不应出现但同样不谎报档位。 */
    fun tier(delayMs: Int): Tier = when {
        delayMs <= 0 -> Tier.NONE
        delayMs <= GOOD_MAX_MS -> Tier.GOOD
        delayMs <= FAIR_MAX_MS -> Tier.FAIR
        else -> Tier.POOR
    }
}
