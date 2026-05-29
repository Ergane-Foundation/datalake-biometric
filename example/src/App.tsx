import { Text, View, StyleSheet } from 'react-native';
import { BiometricSDK } from 'datalake-biometric';

export default function App() {
  return (
    <View style={styles.container}>
      <Text>Biometric SDK initialized</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
