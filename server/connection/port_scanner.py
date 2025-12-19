"""Serial port scanning utilities.

Provides functionality to list available COM ports.
"""

from typing import List, Dict, Any

from server.utils.logging import log

# Check if pyserial is available
try:
    import serial
    import serial.tools.list_ports
    SERIAL_AVAILABLE = True
except ImportError:
    SERIAL_AVAILABLE = False
    log("WARNING: pyserial not installed. COM port functionality will be disabled.")
    log("Install with: pip install pyserial")


def list_available_ports() -> List[Dict[str, Any]]:
    """List all available COM ports.
    
    Returns:
        A list of dictionaries containing port information:
        - path: The device path (e.g., "COM3" or "/dev/ttyUSB0")
        - friendlyName: Human-readable name
        - description: Port description
        - hwid: Hardware ID
    """
    if not SERIAL_AVAILABLE:
        return []
    
    ports = []
    try:
        for port_info in serial.tools.list_ports.comports():
            ports.append({
                "path": port_info.device,
                "friendlyName": f"{port_info.device} - {port_info.description}",
                "description": port_info.description,
                "hwid": port_info.hwid
            })
    except Exception as e:
        log(f"[PortScanner] Error listing ports: {e}")
    
    return ports

