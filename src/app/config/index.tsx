import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef } from "react";
import { Text, View } from "react-native";

export default function Index() {
    // npx uri-scheme open "oneoh-networktools://config?data=aHR0cHM6Ly93d3cuZ29vZ2xlLmNvbQ==" --ios
    // oneoh-networktools://config?data=aHR0cHM6Ly93d3cuZ29vZ2xlLmNvbQ==
    const { data } = useLocalSearchParams<{ data: string }>();

    const prevDataRef = useRef<string>("");

    useEffect(() => {
        console.log('Current deep link data:', data);
        if (data && prevDataRef.current !== data) {
            console.log('Received deep link data:', data);
            prevDataRef.current = data;
        }
        return () => {
            console.log('Cleaning up deep link data');
            prevDataRef.current = "";
        };
    }, [data]);

    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text>Config Page</Text>
        </View>
    );
}
