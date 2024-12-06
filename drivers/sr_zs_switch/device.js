'use strict';

const { ZigBeeDevice } = require('homey-zigbeedriver');
const { CLUSTER } = require('zigbee-clusters');

class SRZSSwitch extends ZigBeeDevice {

    async onNodeInit({ zclNode }) {
        this.printNode();

      for (let i = 1; i <= 3; i++) {
        await this.configureAttributeReporting([
          {
            endpointId: i,
            cluster: CLUSTER.ON_OFF,
            attributeName: 'onOff',
            minInterval: 0,
            maxInterval: 300,
            minChange: 1
          }
        ]);

        this.registerCapability(`onoff_${i}`, CLUSTER.ON_OFF, {
          endpoint: i,
          get: 'onOff',
          getOpts: {},
          set: 'toggle',
          setParser: () => ({}),
          report: 'onOff',
          reportParser: value => value
        });
      }

      await this.magicallyConfigureTuyaSeparateOnoffSwitchingOnEndpoints(zclNode);

// Rejestruj akcje dla endpointów 1, 2 i 3
      registerSetOnOffAction.call(this, 'set_onoff_1_true', 1, true);
      registerSetOnOffAction.call(this, 'set_onoff_1_false', 1, false);
      registerSetOnOffAction.call(this, 'set_onoff_2_true', 2, true);
      registerSetOnOffAction.call(this, 'set_onoff_2_false', 2, false);
      registerSetOnOffAction.call(this, 'set_onoff_3_true', 3, true);
      registerSetOnOffAction.call(this, 'set_onoff_3_false', 3, false);
    }


  async magicallyConfigureTuyaSeparateOnoffSwitchingOnEndpoints(zclNode) {
    await zclNode.endpoints[1].clusters.basic.readAttributes([
      'manufacturerName',
      'zclVersion',
      'appVersion',
      'modelId',
      'powerSource',
      'attributeReportingStatus'
    ])
      .catch(err => {
        this.error('Error when reading device attributes ', err);
      });
  }
}

// Funkcja rejestrująca akcję włączania/wyłączania dla danego endpointu
function registerSetOnOffAction(cardName, endpointId, state) {
  const actionCard = this.homey.flow.getActionCard(cardName);
  actionCard.registerRunListener(async (args) => {
    this.log(`Executing action ${cardName}`);
    try {
      if(state) {
        await this.zclNode.endpoints[endpointId].clusters.onOff.setOn();  // Włącz
      } else {
        await this.zclNode.endpoints[endpointId].clusters.onOff.setOff(); // Wyłącz
      }
    } catch (error) {
      this.error(`Error executing ${cardName}`, error);
      return false; // Zwracamy false, gdy wystąpi błąd
    }
  });
}

module.exports = SRZSSwitch;
