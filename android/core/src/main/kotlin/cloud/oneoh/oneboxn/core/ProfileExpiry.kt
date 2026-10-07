package cloud.oneoh.oneboxn.core

/**
 * 配置到期的分档与剩余天数。
 *
 * 只分档、不定色：档位到颜色、图标与文案的映射属呈现层。阈值在此处唯一声明。
 * golden/profile-expiry.json 是两端行为裁判（Apple Core/ProfileExpiry.swift）。
 */
sealed interface ProfileExpiry {
    /** 剩余天数：已到期为 0；没有到期时间时为 null，不落成一个 0。 */
    val daysLeft: Long?

    /** 服务端没有下发到期时间。不是「永久」，也不是「已到期」。 */
    data object None : ProfileExpiry {
        override val daysLeft: Long? get() = null
    }

    data class Normal(override val daysLeft: Long) : ProfileExpiry

    /** 剩余天数不超过 [SOON_MAX_DAYS]。 */
    data class Soon(override val daysLeft: Long) : ProfileExpiry

    /** 到期那一刻即算到期。 */
    data object Expired : ProfileExpiry {
        override val daysLeft: Long get() = 0
    }

    companion object {
        /** 即将到期档的上界（含）。 */
        const val SOON_MAX_DAYS = 7L

        private const val SECONDS_PER_DAY = 86_400L

        /**
         * 两个参数都是 Unix 纪元秒。剩余天数按时长向上取整（剩一秒也算 1 天，与参考实现同式），
         * 不按日历日数，故与时区、本地日界无关。
         */
        fun of(expireTime: Long, now: Long): ProfileExpiry {
            if (expireTime <= 0) return None
            // 差值不会溢出：到期时刻至多 Long.MAX_VALUE，而此刻是正数。
            val remaining = expireTime - now
            if (remaining <= 0) return Expired
            val days = (remaining - 1) / SECONDS_PER_DAY + 1
            return if (days <= SOON_MAX_DAYS) Soon(days) else Normal(days)
        }
    }
}
