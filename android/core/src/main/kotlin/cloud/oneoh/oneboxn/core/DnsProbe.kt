package cloud.oneoh.oneboxn.core

/**
 * 直连 DNS 探测纯件：候选表、查询构包、响应判定的唯一出处。
 * 竞速与 UDP IO 在平台层（net/DnsRace）；本类型零 IO、零时钟，golden 锁定（dns-probe.json）。
 */
object DnsProbe {
    /** 候选公共 DNS，与参考实现逐字一致；候选表变更即行为变更，须同步夹具。 */
    val SERVERS: List<String> = listOf(
        "1.0.0.1",
        "1.1.1.1",
        "1.2.4.8",
        "101.101.101.101",
        "101.102.103.104",
        "114.114.114.114",
        "114.114.115.115",
        "119.29.29.29",
        "149.112.112.112",
        "149.112.112.9",
        "180.184.1.1",
        "180.184.2.2",
        "180.76.76.76",
        "2.188.21.131",
        "2.188.21.132",
        "2.189.44.44",
        "202.175.3.3",
        "202.175.3.8",
        "208.67.220.220",
        "208.67.220.222",
        "208.67.222.220",
        "208.67.222.222",
        "210.2.4.8",
        "223.5.5.5",
        "223.6.6.6",
        "77.88.8.1",
        "77.88.8.8",
        "8.8.4.4",
        "8.8.8.8",
        "9.9.9.9",
    )

    /** 入口总限时 = 单探测 socket 超时（毫秒）。 */
    const val TIMEOUT_MS = 500L

    /** DNS 服务端口。 */
    const val PORT = 53

    /** `www.baidu.com` A 查询（公共探测目标、非受信域名），Transaction ID 0x1234。 */
    fun queryBytes(): ByteArray {
        val bytes = ArrayList<Byte>(31)
        listOf(
            0x12, 0x34, // Transaction ID
            0x01, 0x00, // 标准查询
            0x00, 0x01, // Questions: 1
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // Answer/Authority/Additional: 0
        ).forEach { bytes.add(it.toByte()) }
        for (label in listOf("www", "baidu", "com")) {
            bytes.add(label.length.toByte())
            label.encodeToByteArray().forEach(bytes::add)
        }
        bytes.add(0) // 域名终止
        listOf(0x00, 0x01, 0x00, 0x01).forEach { bytes.add(it.toByte()) } // Type A + Class IN
        return bytes.toByteArray()
    }

    /**
     * 长度 ≥12 且 Transaction ID 回显即接受。有意不校验 A 记录与 rcode——
     * DNS 污染/审查环境下被污染的应答同样证明该服务器可达且低延迟。
     */
    fun isAcceptable(response: ByteArray): Boolean =
        response.size >= 12 && response[0] == 0x12.toByte() && response[1] == 0x34.toByte()
}
