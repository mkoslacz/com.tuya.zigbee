"use strict";

const { ZigBeeDevice } = require("homey-zigbeedriver");
const { Cluster, debug, CLUSTER } = require("zigbee-clusters");
const TuyaWindowCoveringCluster = require("../../lib/TuyaWindowCoveringCluster");
const { mapValueRange } = require('../../lib/util');

Cluster.addCluster(TuyaWindowCoveringCluster);

const UP_OPEN = 'upOpen';
const DOWN_CLOSE = 'downClose';
const REPORT_DEBOUNCER = 5000;

class curtain_module extends ZigBeeDevice {

    invertPercentageLiftValue = false;

    constructor(...args) {
        super(...args);
        this._reportPercentageDebounce = null;
        this._reportDebounceEnabled = false;
    }

    async onNodeInit({ zclNode }) {
        await super.onNodeInit({ zclNode });

        this.printNode();

        // code borrowed from here most recent version of zigbee driver to handle lift percentage + invert correctly
        // remove once the package was updated
        // https://github.com/athombv/node-homey-zigbeedriver/blob/master/lib/system/capabilities/windowcoverings_set/windowCovering.js
        this.registerCapability(
            "windowcoverings_set",
            CLUSTER.WINDOW_COVERING,
            {
                setParser: async (value) => {
                    // Refresh timer or set new timer to prevent reports from updating the dim slider directly
                    // when set command from Homey
                    if (this._reportPercentageDebounce) {
                      this._reportPercentageDebounce.refresh();
                    } else {
                      this._reportPercentageDebounce = this.homey.setTimeout(() => {
                        this._reportDebounceEnabled = false;
                        this._reportPercentageDebounce = null;
                      }, REPORT_DEBOUNCER);
                    }

                    // Used to check if reports are generated based on set command from Homey
                    this._reportDebounceEnabled = true;

                    // Override goToLiftPercentage to enforce blind to open/close completely
                    if (value === 0 || value === 1) {
                      this.debug(`set → \`windowcoverings_set\`: ${value} → setParser → ${value === 1 ? UP_OPEN : DOWN_CLOSE}`);
                      const { endpoint } = this._getClusterCapabilityConfiguration('windowcoverings_set', CLUSTER.WINDOW_COVERING);
                      const windowCoveringEndpoint = endpoint ?? this.getClusterEndpoint(CLUSTER.WINDOW_COVERING);
                      if (windowCoveringEndpoint === null) throw new Error('missing_window_covering_cluster');

                      const windowCoveringCommand = value === 1 ? UP_OPEN : DOWN_CLOSE;
                      await this.zclNode.endpoints[windowCoveringEndpoint].clusters
                        .windowCovering[windowCoveringCommand]();

                      await this.setCapabilityValue('windowcoverings_set', value);
                      return null;
                    }

                    const mappedValue = mapValueRange(
                      0, 1, 0, 100, this.invertPercentageLiftValue ? 1 - value : value,
                    );
                    const gotToLiftPercentageCommand = {
                      // Round, otherwise might not be accepted by device
                      percentageLiftValue: Math.round(mappedValue),
                    };
                    this.debug(`set → \`windowcoverings_set\`: ${value} → setParser → goToLiftPercentage`, gotToLiftPercentageCommand);
                    // Send goToLiftPercentage command
                    return gotToLiftPercentageCommand;
                },
                reportParser: (value) => {
                    // Validate input
                    if (value < 0 || value > 100) return null;

                    // Parse input value
                    const parsedValue = mapValueRange(
                      0, 100, 0, 1, this.invertPercentageLiftValue ? 100 - value : value,
                    );

                    // Refresh timer if needed
                    if (this._reportPercentageDebounce) {
                      this._reportPercentageDebounce.refresh();
                    }

                    // If reports are not generated by set command from Homey update directly
                    if (!this._reportDebounceEnabled) return parsedValue;

                    // Return value
                    return null;
                },
            }
        );
        await this._configureStateCapability(this.getSetting("has_state"));

        const attrs = await this.zclNode.endpoints[1].clusters.windowCovering
            .readAttributes("calibrationTime", "motorReversal")
            .catch((err) =>
                this.error("Error when reading settings from device", err)
            );

        if (attrs.calibrationTime) {
            await this.setSettings({ movetime: attrs.calibrationTime / 10 });
        }

        if (attrs.motorReversal) {
            this.setSettings({ reverse: attrs.motorReversal === 'On' })
        }

        const moveOpen = this.homey.flow.getActionCard("move_open");
        moveOpen.registerRunListener(async (args, state) => {
            await this.zclNode.endpoints[1].clusters.windowCovering[UP_OPEN]();
        });

        const moveClose = this.homey.flow.getActionCard("move_close");
        moveClose.registerRunListener(async (args, state) => {
            await this.zclNode.endpoints[1].clusters.windowCovering[DOWN_CLOSE]();
        });
    }

    // When upgrading to node-zigbee-clusters v.2.0.0 this must be adressed:
    // v2.0.0
    // Changed Cluster.readAttributes signature, attributes must now be specified as an array of strings.
    // zclNode.endpoints[1].clusters.windowCovering.readAttributes(['motorReversal', 'ANY OTHER IF NEEDED']);

    async onSettings({ oldSettings, newSettings, changedKeys }) {
        try {
            if (changedKeys.includes("reverse")) {
                const motorReversed = newSettings["reverse"];
                await this.zclNode.endpoints[1].clusters.windowCovering.writeAttributes(
                    { motorReversal: motorReversed ? "On" : "Off" }
                );

                if (this.motorReversed === 'On') {
                    this.invertPercentageLiftValue = true;
                }
            }

            if (changedKeys.includes("calibration_mode")) {
                const calibrationMode = newSettings["calibration_mode"];
                await this.zclNode.endpoints[1].clusters.windowCovering.writeAttributes(
                    { calibrationMode: calibrationMode ? "Start" : "End" }
                );
            }

            if (changedKeys.includes("movetime")) {
                const movetime = newSettings["movetime"];
                await this.zclNode.endpoints[1].clusters.windowCovering.writeAttributes(
                    { calibrationTime: movetime * 10 }
                );
            }

            if (changedKeys.includes("has_state")) {
                await this._configureStateCapability(newSettings["has_state"]);
            }
        } catch (e) {
            this.error("Error during setting change", e);
        }
    }

    onDeleted() {
        this.log("Curtain Module removed");
    }

    onUninit() {
        if (this._reportPercentageDebounce) {
          this.homey.clearTimeout(this._reportPercentageDebounce);
        }
    }

    async _configureStateCapability(hasState) {
        const key = "windowcoverings_state";

        if (hasState) {
            if (!this.hasCapability(key)) {
                await this.addCapability(key);
            }

            this.registerCapability(key, CLUSTER.WINDOW_COVERING, {
                report: "windowCoverStatus",
                reportParser: (val) => {
                    return {
                        Open: "up",
                        Stop: "idle",
                        Close: "down",
                    }[val];
                },
                reportOpts: {
                    configureAttributeReporting: {
                        minInterval: 0, // No minimum reporting interval
                        maxInterval: 300, // Maximally every ~5 minutes
                        minChange: 1, // Report when value changed by 1
                    },
                },
            });
        } else if (this.hasCapability(key)) {
            await this.removeCapability(key);
        }
    }
    
}

module.exports = curtain_module;
