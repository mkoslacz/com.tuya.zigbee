'use strict';

const { ZigBeeDevice } = require('homey-zigbeedriver');
const { CLUSTER, Cluster, ZCLDataTypes } = require('zigbee-clusters');
const TuyaOnOffCluster = require('../../lib/TuyaOnOffCluster');

Cluster.addCluster(TuyaOnOffCluster);

class switch_1_gang_metering extends ZigBeeDevice {

  async onNodeInit({ zclNode }) {

    this.printNode();

    // Initialize reporting offsets and settings
    this.meteringOffset = this.getSetting('metering_offset');
    this.measureOffset = this.getSetting('measure_offset') * 100;
    this.minReportPower = this.getSetting('minReportPower') * 1000; 
    this.minReportEnergy = this.getSetting('minReportEnergy') * 1000;
    this.minReportCurrent = this.getSetting('minReportCurrent') * 1000;
    this.minReportVoltage = this.getSetting('minReportVoltage') * 1000;

    // Register onoff capability for the single endpoint (1)
    this.registerCapability('onoff', CLUSTER.ON_OFF, {
      endpoint: 1,
      getOpts: {
        getOnStart: true,
      }
    });

    // Attempt to configure instant reporting for the onOff attribute
    try {
      await zclNode.endpoints[1].clusters.onOff.configureReporting({
        attribute: 'onOff',
        minimumReportInterval: 1,
        maximumReportInterval: 600,
        reportableChange: 1,
      });
      this.log('Configured instant reporting for onOff on endpoint 1');
    } catch (error) {
      this.error('Failed to configure onOff reporting for endpoint 1, setting up fallback polling', error);
      this.setCapabilityOptions('onoff', {
        getOpts: {
          getOnStart: true,
          pollInterval: 60000, // Poll every 60 seconds as a fallback
        },
      });
    }

    // Read basic attributes from the single endpoint
    try {
      await zclNode.endpoints[1].clusters.basic.readAttributes(['manufacturerName', 'zclVersion', 'appVersion', 'modelId', 'powerSource', 'attributeReportingStatus']);
      this.log('Basic attributes read successfully');
    } catch (err) {
      this.error('Error when reading device attributes ', err);
    }

    // Register meter_power capability
    this.registerCapability('meter_power', CLUSTER.METERING, {
      reportParser: value => (value * this.meteringOffset) / 100.0,
      getParser: value => (value * this.meteringOffset) / 100.0,
      get: 'currentSummationDelivered',
      report: 'currentSummationDelivered',
      getOpts: {
        getOnStart: true,
        pollInterval: this.minReportEnergy,
      }
    });

    // Register measure_power capability
    this.registerCapability('measure_power', CLUSTER.ELECTRICAL_MEASUREMENT, {
      get: 'activePower',
      report: 'activePower',
      reportParser: value => (value * this.measureOffset) / 100,
      getOpts: {
        getOnStart: true,
        pollInterval: this.minReportPower,
      }
    });

    // Register measure_current capability
    this.registerCapability('measure_current', CLUSTER.ELECTRICAL_MEASUREMENT, {
      get: 'rmsCurrent',
      report: 'rmsCurrent',
      reportParser: value => value / 1000,
      getOpts: {
        getOnStart: true,
        pollInterval: this.minReportCurrent,
      }
    });

    // Register measure_voltage capability
    this.registerCapability('measure_voltage', CLUSTER.ELECTRICAL_MEASUREMENT, {
      get: 'rmsVoltage',
      report: 'rmsVoltage',
      reportParser: value => value,
      getOpts: {
        getOnStart: true,
        pollInterval: this.minReportVoltage,
      }
    });

    this.registerCapabilityListener('button.reset_meter', async () => {
     await this.resetEnergyMeter();
    });

  }

  async resetEnergyMeter() {
    this.log('Starting energy meter reset...');
    
    try {
      const node = await this.homey.zigbee.getNode(this);
      
      // Send raw reset frame
      await node.sendFrame(
        1,  // endpoint id
        0,  // cluster id (basic cluster)
        Buffer.from([
          1,  // frame control
          0,  // transaction sequence number
          0,  // command id (reset)
        ])
      );
      
      // Wait a moment for the reset to take effect
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Force refresh meter_power capability
      await this.refreshCapabilityValue('meter_power');
      
      this.log('Energy meter reset completed');
    } catch (err) {
      this.error('Error during energy meter reset:', err);
      throw err;
    }
  }

  // Helper method to refresh capability value
  async refreshCapabilityValue(capability) {
    try {
      const value = await this.getCapabilityValue(capability);
      await this.setCapabilityValue(capability, value);
    } catch (err) {
      this.error(`Failed to refresh ${capability}:`, err);
    }
  }

  onDeleted() {
    this.log("1 Gang Switch with metering removed");
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('onSettings called with:', { oldSettings, newSettings, changedKeys });
    // Aktualizuj offsety i interwały raportowania
    try {
    if (changedKeys.includes('metering_offset')) {
      this.meteringOffset = newSettings.metering_offset;
    }
    if (changedKeys.includes('measure_offset')) {
      this.measureOffset = newSettings.measure_offset * 100;
    }
    if (changedKeys.includes('minReportPower')) {
      this.minReportPower = newSettings.minReportPower * 1000;
      await this.setCapabilityOptions('measure_power', {
        getOpts: {
          pollInterval: this.minReportPower,
        },
      });
    }
    if (changedKeys.includes('minReportEnergy')) {
      this.minReportEnergy = newSettings.minReportEnergy * 1000;
      await this.setCapabilityOptions('meter_power', {
        getOpts: {
          pollInterval: this.minReportEnergy,
        },
      });
    }
    if (changedKeys.includes('minReportCurrent')) {
      this.minReportCurrent = newSettings.minReportCurrent * 1000;
      await this.setCapabilityOptions('measure_current', {
        getOpts: {
          pollInterval: this.minReportCurrent,
        },
      });
    }
    if (changedKeys.includes('minReportVoltage')) {
      this.minReportVoltage = newSettings.minReportVoltage * 1000;
      await this.setCapabilityOptions('measure_voltage', {
        getOpts: {
          pollInterval: this.minReportVoltage,
        },
      });
    }
    this.log('Settings updated successfully');
    } catch (error) {
      this.error('Error when updating settings:', error);
    }
  }

}

module.exports = switch_1_gang_metering;



/* "ids": {
    "modelId": "TS0001",
    "manufacturerName": "_TZ3000_prits6g4"
  },
  "endpoints": {
    "endpointDescriptors": [
      {
        "endpointId": 1,
        "applicationProfileId": 260,
        "applicationDeviceId": 256,
        "applicationDeviceVersion": 0,
        "_reserved1": 1,
        "inputClusters": [
          0,
          6,
          3,
          4,
          5,
          57345,
          2820,
          1794
        ],
        "outputClusters": []
      }
    ],
    "endpoints": {
      "1": {
        "clusters": {
          "basic": {
            "attributes": "UNSUP_GENERAL_COMMAND",
            "commandsGenerated": "UNSUP_GENERAL_COMMAND",
            "commandsReceived": "UNSUP_GENERAL_COMMAND"
          },
          "onOff": {
            "attributes": "UNSUP_GENERAL_COMMAND",
            "commandsGenerated": "UNSUP_GENERAL_COMMAND",
            "commandsReceived": "UNSUP_GENERAL_COMMAND"
          },
          "identify": {
            "commandsGenerated": "UNSUP_GENERAL_COMMAND",
            "commandsReceived": "UNSUP_GENERAL_COMMAND"
          },
          "groups": {},
          "scenes": {
            "attributes": "UNSUP_GENERAL_COMMAND",
            "commandsGenerated": "UNSUP_GENERAL_COMMAND",
            "commandsReceived": "UNSUP_GENERAL_COMMAND"
          },
          "electricalMeasurement": {
            "attributes": "UNSUP_GENERAL_COMMAND",
            "commandsGenerated": "UNSUP_GENERAL_COMMAND",
            "commandsReceived": "UNSUP_GENERAL_COMMAND"
          },
          "metering": {
            "attributes": "UNSUP_GENERAL_COMMAND",
            "commandsGenerated": "UNSUP_GENERAL_COMMAND",
            "commandsReceived": "UNSUP_GENERAL_COMMAND"
          }
        },
        "bindings": {}
      }
    } */
