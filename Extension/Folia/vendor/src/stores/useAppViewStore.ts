export const useAppViewStore = <T>(select:(state:{view:'player'})=>T):T => select({view:'player'});
