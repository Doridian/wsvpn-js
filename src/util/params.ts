export type InitParameters = {
    mode: "TUN" | "TAP";
    do_ip_config: boolean;
    ip_address: string;
    client_id: string;
    server_id: string;
    mtu: number;
};
