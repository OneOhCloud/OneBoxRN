/// 直连 DNS 探测纯件：候选表、查询构包、响应判定的唯一出处。
/// 竞速与 UDP IO 在平台层（App/Net/DnsRace）；本类型零 IO、零时钟，golden 锁定（dns-probe.json）。
public enum DnsProbe {
    /// 候选公共 DNS，与参考实现逐字一致；候选表变更即行为变更，须同步夹具。
    public static let SERVERS: [String] = [
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
    ]

    /// 入口总限时 = 单探测 socket 超时（毫秒）。
    public static let TIMEOUT_MS = 500

    /// DNS 服务端口。
    public static let PORT = 53

    /// `www.baidu.com` A 查询（公共探测目标、非受信域名），Transaction ID 0x1234。
    public static func queryBytes() -> [UInt8] {
        var bytes: [UInt8] = [
            0x12, 0x34, // Transaction ID
            0x01, 0x00, // 标准查询
            0x00, 0x01, // Questions: 1
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // Answer/Authority/Additional: 0
        ]
        for label in ["www", "baidu", "com"] {
            bytes.append(UInt8(label.utf8.count))
            bytes.append(contentsOf: Array(label.utf8))
        }
        bytes.append(0) // 域名终止
        bytes.append(contentsOf: [0x00, 0x01, 0x00, 0x01]) // Type A + Class IN
        return bytes
    }

    /// 长度 ≥12 且 Transaction ID 回显即接受。有意不校验 A 记录与 rcode——
    /// DNS 污染/审查环境下被污染的应答同样证明该服务器可达且低延迟（判据经对抗性网络真机验证，勿改）。
    public static func isAcceptable(_ response: [UInt8]) -> Bool {
        response.count >= 12 && response[0] == 0x12 && response[1] == 0x34
    }
}
