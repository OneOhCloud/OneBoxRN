import { createMMKV } from 'react-native-mmkv'

export const storage = createMMKV(
    {
        id: 'oneoh-config-storage',
        encryptionKey: 'oneoh-networktools',
    }
)